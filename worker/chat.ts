import { FREE_MODEL_IDS, getHostedModel } from "../lib/models";
import { profile as defaultProfile } from "../lib/profile";
import { buildSystemPrompt } from "../lib/prompt-builder";
import type { AuthEnv } from "./auth";
import { decryptSecret } from "./crypto";
import { getEncryptionMasterKey, loadStoredRecord } from "./publish";

export interface ChatEnv extends AuthEnv {
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  OPENAI_BASE_URL?: string;
  DEEPSEEK_API_KEY?: string;
}

interface IncomingMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ClientToolCall {
  name: string;
  args: Record<string, string>;
}

const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 15;
const DAILY_CHAT_LIMIT_PER_SITE = 30;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
const memSiteChatUsage = new Map<string, number>();

function todayDateKey(): string {
  return new Date().toISOString().slice(0, 10);
}

async function consumeSiteDailyChatQuota(slug: string, env: ChatEnv): Promise<boolean> {
  const key = `chat_usage:${slug}:${todayDateKey()}`;
  let current = 0;
  if (env.PROFILES_KV) {
    const raw = await env.PROFILES_KV.get(key);
    const parsed = Number(raw ?? "0");
    current = Number.isFinite(parsed) ? parsed : 0;
  } else {
    current = memSiteChatUsage.get(key) ?? 0;
  }
  if (current >= DAILY_CHAT_LIMIT_PER_SITE) return false;
  const next = current + 1;
  if (env.PROFILES_KV) {
    await env.PROFILES_KV.put(key, String(next));
  } else {
    memSiteChatUsage.set(key, next);
  }
  return true;
}

const VALID_SECTIONS = new Set(["work", "capabilities", "experience", "contact"]);
const VALID_THEMES = new Set(["editorial", "terminal", "bento"]);

const PERSONA_NOTES: Record<string, string> = {
  hr: "\n\n## Active Visitor Persona: HR / Recruiter\nFocus on crisp 30-second scannability: years of experience, role fit, measurable impact, and easy contact info.",
  cto: "\n\n## Active Visitor Persona: Engineering Manager / CTO\nFocus on architecture trade-offs, reliability, failure modes, and testing rigor.",
  founder: "\n\n## Active Visitor Persona: Founder / Product Lead\nFocus on 0→1 ownership, shipping velocity, and user/business impact.",
};

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (bucket.count >= RATE_LIMIT) return false;
  bucket.count += 1;
  return true;
}

function parseLeadingToolTag(
  raw: string,
  validSlugs: Set<string>,
  allowThemeSwitch: boolean,
): { tool: ClientToolCall | null; remainder: string } {
  const match = raw.match(/^\s*\[\[TOOL:([a-z_]+)(?:\|([^\]]+))?\]\]\s*/);
  if (!match) return { tool: null, remainder: raw };
  const name = match[1];
  const arg = (match[2] ?? "").trim();
  const remainder = raw.slice(match[0].length);

  if (name === "open_project" && validSlugs.has(arg)) {
    return { tool: { name, args: { slug: arg } }, remainder };
  }
  if (name === "scroll_to_section" && VALID_SECTIONS.has(arg)) {
    return { tool: { name, args: { section: arg } }, remainder };
  }
  if (name === "switch_language" && (arg === "en" || arg === "zh")) {
    return { tool: { name, args: { lang: arg } }, remainder };
  }
  if (name === "switch_theme" && allowThemeSwitch && VALID_THEMES.has(arg)) {
    return { tool: { name, args: { theme: arg } }, remainder };
  }
  if (name === "copy_contact") {
    return { tool: { name, args: {} }, remainder };
  }
  if (name === "draft_email") {
    const sepIdx = arg.indexOf("|");
    const subject = (sepIdx >= 0 ? arg.slice(0, sepIdx) : arg).trim().slice(0, 140);
    const body = (sepIdx >= 0 ? arg.slice(sepIdx + 1) : "").replace(/\\n/g, "\n").trim().slice(0, 1500);
    return { tool: { name, args: { subject, body } }, remainder };
  }
  return { tool: null, remainder };
}

export async function handleChatRequest(request: Request, env: ChatEnv): Promise<Response> {
  if (request.method !== "POST") {
    return jsonError(405, "Method not allowed.");
  }

  const openaiKey = env.OPENAI_API_KEY?.trim() || "";
  const deepseekKey = env.DEEPSEEK_API_KEY?.trim() || "";
  if (!openaiKey && !deepseekKey) {
    return jsonError(
      503,
      "AI chat is not configured yet. Add OPENAI_API_KEY or DEEPSEEK_API_KEY to enable it.",
    );
  }

  const ip =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";

  if (!checkRateLimit(ip)) {
    return jsonError(429, "Too many requests. Please wait a minute and try again.");
  }

  let body: { messages?: unknown; lang?: unknown; persona?: unknown; quote?: unknown; profileSlug?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError(400, "Invalid JSON payload.");
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return jsonError(400, "Messages array is required.");
  }

  const sanitized: IncomingMessage[] = [];
  for (const item of body.messages.slice(-6)) {
    if (!item || typeof item !== "object") continue;
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    if ((role === "user" || role === "assistant") && typeof content === "string") {
      const trimmed = content.trim().slice(0, 2200);
      if (trimmed) sanitized.push({ role, content: trimmed });
    }
  }

  if (sanitized.length === 0 || sanitized[sanitized.length - 1].role !== "user") {
    return jsonError(400, "A non-empty user message is required.");
  }

  const siteKey =
    typeof body.profileSlug === "string" && body.profileSlug.trim()
      ? body.profileSlug.trim().toLowerCase()
      : "__demo__";
  const isPersonalHosted = siteKey !== "__demo__";
  const allowThemeSwitch = !isPersonalHosted;

  const storedRecord = isPersonalHosted ? await loadStoredRecord(siteKey, env) : null;
  const activeProfile = storedRecord?.profile ?? defaultProfile;
  const validSlugs = new Set(activeProfile.projects.map((p) => p.slug));

  // Check if site has an encrypted BYOK key (unlocks unlimited daily visitor chat)
  const siteChat = storedRecord?.chatConfig;
  let byokCreds: { baseUrl: string; key: string; model: string } | null = null;
  if (siteChat?.mode === "byok" && siteChat.byokKeyEncrypted) {
    const decrypted = await decryptSecret(siteChat.byokKeyEncrypted, getEncryptionMasterKey(env));
    if (decrypted) {
      byokCreds = {
        baseUrl: (siteChat.byokBaseUrl || "https://api.openai.com/v1").replace(/\/+$/, ""),
        key: decrypted,
        model: siteChat.byokModel || "gpt-4o-mini",
      };
    }
  }

  if (!byokCreds) {
    const withinDailyQuota = await consumeSiteDailyChatQuota(siteKey, env);
    if (!withinDailyQuota) {
      const isZh = body.lang === "zh";
      return jsonError(
        429,
        isZh
          ? `该站点今日免费 AI 对话额度（${DAILY_CHAT_LIMIT_PER_SITE} 次/天）已用完，请明日再试（作者绑定自有 API Key 可解锁无限对话）。`
          : `This site has reached its free daily AI chat quota (${DAILY_CHAT_LIMIT_PER_SITE}/day). Please try again tomorrow.`,
      );
    }
  }

  const personaKey = typeof body.persona === "string" && body.persona in PERSONA_NOTES ? body.persona : "default";
  const quoteText = typeof body.quote === "string" ? body.quote.trim().slice(0, 400) : "";

  const systemContent =
    buildSystemPrompt(activeProfile, { allowThemeSwitch }) +
    (PERSONA_NOTES[personaKey] ?? "") +
    (quoteText
      ? `\n\n## Visitor Highlighted Text\nThe visitor highlighted this excerpt on the page:\n"""\n${quoteText}\n"""`
      : "");

  const cf = (request as Request & { cf?: { colo?: string; country?: string } }).cf;
  const edgeColo = cf?.colo || "EDGE";
  const isChinaRegion =
    cf?.country === "CN" ||
    cf?.country === "HK" ||
    cf?.country === "MO" ||
    edgeColo === "HKG" ||
    edgeColo === "MFM";

  const openaiBase = (env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");
  const openaiModel = env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
  const startedAt = Date.now();

  const callProvider = (url: string, key: string, mdl: string) =>
    fetch(`${url}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: mdl,
        stream: true,
        temperature: 0.4,
        max_tokens: 900,
        messages: [{ role: "system", content: systemContent }, ...sanitized],
      }),
    });

  const candidates: Array<{ baseUrl: string; key: string; model: string }> = [];
  if (byokCreds) {
    candidates.push(byokCreds);
  } else {
    const requestedModelId =
      siteChat?.mode === "hosted" && siteChat.hostedModelId && FREE_MODEL_IDS.has(siteChat.hostedModelId)
        ? siteChat.hostedModelId
        : "auto";
    const chosen = getHostedModel(requestedModelId);

    if (chosen.provider === "deepseek" && deepseekKey) {
      candidates.push({
        baseUrl: "https://api.deepseek.com/v1",
        key: deepseekKey,
        model: chosen.apiModel || "deepseek-chat",
      });
      if (chosen.apiModel !== "deepseek-chat") {
        candidates.push({ baseUrl: "https://api.deepseek.com/v1", key: deepseekKey, model: "deepseek-chat" });
      }
      if (openaiKey) candidates.push({ baseUrl: openaiBase, key: openaiKey, model: openaiModel });
    } else if (chosen.provider === "openai" && openaiKey) {
      candidates.push({ baseUrl: openaiBase, key: openaiKey, model: chosen.apiModel || openaiModel });
      if (deepseekKey) candidates.push({ baseUrl: "https://api.deepseek.com/v1", key: deepseekKey, model: "deepseek-chat" });
    } else if (isChinaRegion && deepseekKey) {
      candidates.push({ baseUrl: "https://api.deepseek.com/v1", key: deepseekKey, model: "deepseek-chat" });
      if (openaiKey) candidates.push({ baseUrl: openaiBase, key: openaiKey, model: openaiModel });
    } else {
      if (openaiKey) candidates.push({ baseUrl: openaiBase, key: openaiKey, model: openaiModel });
      if (deepseekKey) candidates.push({ baseUrl: "https://api.deepseek.com/v1", key: deepseekKey, model: "deepseek-chat" });
    }
  }

  let upstream: Response | null = null;
  let model = candidates[0].model;
  for (const cand of candidates) {
    try {
      const res = await callProvider(cand.baseUrl, cand.key, cand.model);
      if (res.ok && res.body) {
        upstream = res;
        model = cand.model;
        break;
      }
      upstream = res;
    } catch {
      upstream = null;
    }
  }

  if (!upstream) {
    return jsonError(502, "Unable to reach AI provider.");
  }

  if (!upstream.ok || !upstream.body) {
    const status = upstream.status === 429 ? 429 : 502;
    return jsonError(
      status,
      status === 429
        ? "AI provider rate limit reached. Try again shortly."
        : "AI provider returned an error. Check OPENAI_BASE_URL / OPENAI_MODEL or regional availability.",
    );
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let ttftMs: number | null = null;
      let pendingTagBuf = "";
      let checkedLeadingTag = false;

      const emitDelta = (text: string) => {
        if (!text) return;
        if (ttftMs === null) ttftMs = Date.now() - startedAt;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: text })}\n\n`));
      };

      const processChunkText = (chunk: string) => {
        if (checkedLeadingTag) {
          emitDelta(chunk);
          return;
        }
        pendingTagBuf += chunk;
        const trimmedStart = pendingTagBuf.trimStart();
        if (!trimmedStart) return;
        if (!trimmedStart.startsWith("[")) {
          checkedLeadingTag = true;
          emitDelta(pendingTagBuf);
          pendingTagBuf = "";
          return;
        }
        if (trimmedStart.length >= 7 && !trimmedStart.startsWith("[[TOOL:")) {
          checkedLeadingTag = true;
          emitDelta(pendingTagBuf);
          pendingTagBuf = "";
          return;
        }
        const closeIdx = pendingTagBuf.indexOf("]]");
        if (closeIdx !== -1) {
          checkedLeadingTag = true;
          const { tool, remainder } = parseLeadingToolTag(pendingTagBuf, validSlugs, allowThemeSwitch);
          if (tool) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ tool })}\n\n`));
          }
          if (remainder) emitDelta(remainder);
          pendingTagBuf = "";
        } else if (pendingTagBuf.length > 1600) {
          checkedLeadingTag = true;
          emitDelta(pendingTagBuf);
          pendingTagBuf = "";
        }
      };

      const reader = upstream.body!.getReader();
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (data === "[DONE]") continue;
            try {
              const parsed = JSON.parse(data) as {
                choices?: Array<{ delta?: { content?: string } }>;
              };
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) processChunkText(delta);
            } catch {
              // ignore partial frames
            }
          }
        }
        if (pendingTagBuf) {
          const { tool, remainder } = parseLeadingToolTag(pendingTagBuf, validSlugs, allowThemeSwitch);
          if (tool) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ tool })}\n\n`));
          if (remainder) emitDelta(remainder);
        }
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              meta: { model, ttftMs: ttftMs ?? Date.now() - startedAt, totalMs: Date.now() - startedAt, edge: edgeColo },
            })}\n\n`,
          ),
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: "Stream interrupted." })}\n\n`));
      } finally {
        reader.releaseLock();
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
    },
  });
}
