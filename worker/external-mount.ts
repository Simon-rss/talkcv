import { recordVisit } from "./insights";
import type { PublishEnv, StoredProfileRecord } from "./publish";
import { isBotUserAgent, recordSiteTraffic, shouldTrackTraffic } from "./traffic";

export interface ExternalMountEnv extends PublishEnv {
  EXTERNAL_SITE_MOUNTS?: string;
}

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-encoding",
  "content-length",
]);

export function resolveExternalOrigin(
  slug: string,
  record: StoredProfileRecord | null,
  env: ExternalMountEnv,
): string | null {
  const fromRecord = record?.externalOrigin?.trim();
  if (fromRecord && /^https?:\/\//i.test(fromRecord)) {
    return fromRecord.replace(/\/+$/, "");
  }
  const raw = env.EXTERNAL_SITE_MOUNTS?.trim();
  if (!raw) return null;
  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const val = parsed[slug];
      if (typeof val === "string" && /^https?:\/\//i.test(val.trim())) {
        return val.trim().replace(/\/+$/, "");
      }
    } catch {
      return null;
    }
    return null;
  }
  for (const pair of raw.split(",")) {
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const key = pair.slice(0, eq).trim().toLowerCase();
    const val = pair.slice(eq + 1).trim();
    if (key === slug && /^https?:\/\//i.test(val)) {
      return val.replace(/\/+$/, "");
    }
  }
  return null;
}

function extractChatQuestion(bodyText: string): string | undefined {
  if (!bodyText) return undefined;
  try {
    const parsed = JSON.parse(bodyText) as {
      messages?: Array<{ role?: unknown; content?: unknown }>;
    };
    if (!Array.isArray(parsed.messages)) return undefined;
    for (let i = parsed.messages.length - 1; i >= 0; i -= 1) {
      const msg = parsed.messages[i];
      if (msg?.role === "user" && typeof msg.content === "string" && msg.content.trim()) {
        return msg.content.trim().slice(0, 600);
      }
    }
  } catch {
    // ignore invalid JSON
  }
  return undefined;
}

export async function proxyExternalMountedSite(
  request: Request,
  slug: string,
  externalOrigin: string,
  record: StoredProfileRecord | null,
  env: ExternalMountEnv,
  ctx?: { waitUntil(task: Promise<unknown>): void },
): Promise<Response> {
  const url = new URL(request.url);
  const subPath = url.pathname.slice(`/u/${slug}`.length) || "/";
  const upstreamUrl = new URL(`${url.pathname}${url.search}`, externalOrigin);

  const forwardHeaders = new Headers();
  for (const name of [
    "accept",
    "accept-language",
    "content-type",
    "user-agent",
    "x-forwarded-for",
    "cf-connecting-ip",
    "if-none-match",
    "if-modified-since",
  ]) {
    const val = request.headers.get(name);
    if (val) forwardHeaders.set(name, val);
  }
  forwardHeaders.set("x-talkcv-proxy", "1");
  forwardHeaders.set("x-forwarded-host", url.host);
  forwardHeaders.set("x-forwarded-proto", url.protocol.replace(":", ""));

  let bodyText: string | undefined;
  let chatQuestion: string | undefined;
  const isChatPost = request.method === "POST" && subPath === "/api/chat";
  const hasBody = request.method !== "GET" && request.method !== "HEAD";

  if (isChatPost) {
    bodyText = await request.text();
    chatQuestion = extractChatQuestion(bodyText);
  }

  const upstreamRes = await fetch(upstreamUrl.toString(), {
    method: request.method,
    headers: forwardHeaders,
    body: hasBody ? (isChatPost ? bodyText : request.body) : undefined,
    redirect: "manual",
  });

  const outHeaders = new Headers();
  upstreamRes.headers.forEach((value, key) => {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      outHeaders.set(key, value);
    }
  });
  if (record?.noindex) {
    outHeaders.set("x-robots-tag", "noindex, nofollow");
  }

  const response = new Response(upstreamRes.body, {
    status: upstreamRes.status,
    headers: outHeaders,
  });

  const runBg = (task: Promise<unknown>) => {
    const safe = task.catch(() => {});
    if (ctx?.waitUntil) ctx.waitUntil(safe);
    else void safe;
  };

  if (isChatPost && upstreamRes.ok && record && chatQuestion) {
    runBg(recordVisit(slug, record, env, chatQuestion));
  } else if (
    request.method === "GET" &&
    upstreamRes.ok &&
    (outHeaders.get("content-type") ?? "").includes("text/html") &&
    !request.headers.has("next-router-prefetch") &&
    request.headers.get("purpose") !== "prefetch" &&
    request.headers.get("sec-purpose") !== "prefetch" &&
    !isBotUserAgent(request.headers.get("user-agent") || "")
  ) {
    if (record) {
      runBg(recordVisit(slug, record, env));
    }
    if (shouldTrackTraffic(request, url.pathname, response)) {
      runBg(recordSiteTraffic(request, url.pathname, env));
    }
  }

  return response;
}
