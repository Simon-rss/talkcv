import type { PortfolioProfile } from "../lib/schema";

export interface KVNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

export interface PublishEnv {
  PROFILES_KV?: KVNamespaceLike;
}

const RESERVED_SLUGS = new Set([
  "api",
  "create",
  "preview",
  "projects",
  "admin",
  "login",
  "u",
  "s",
  "llms",
  "resume",
  "sitemap",
  "robots",
]);

const memoryStore = new Map<string, string>();

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function normalizeSlug(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

export async function loadPublishedProfile(
  slug: string,
  env: PublishEnv,
): Promise<PortfolioProfile | null> {
  const clean = normalizeSlug(slug);
  if (!clean) return null;
  const key = `profile:${clean}`;
  const raw = env.PROFILES_KV ? await env.PROFILES_KV.get(key) : (memoryStore.get(key) ?? null);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PortfolioProfile;
  } catch {
    return null;
  }
}

export async function handlePublishRequest(request: Request, env: PublishEnv): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed." });
  }

  let body: { slug?: unknown; profile?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body." });
  }

  const slug = normalizeSlug(typeof body.slug === "string" ? body.slug : "");
  if (slug.length < 3) {
    return jsonResponse(400, {
      error: "Handle must be at least 3 characters (letters, numbers, hyphens).",
    });
  }
  if (RESERVED_SLUGS.has(slug)) {
    return jsonResponse(400, { error: `The handle "${slug}" is reserved. Please pick another.` });
  }

  const profileObj = body.profile as Partial<PortfolioProfile> | undefined;
  if (!profileObj || typeof profileObj !== "object" || !profileObj.basics?.name?.en) {
    return jsonResponse(400, { error: "Valid profile payload is required." });
  }

  const serialized = JSON.stringify(profileObj);
  if (serialized.length > 100_000) {
    return jsonResponse(413, { error: "Profile payload is too large (max 100KB)." });
  }

  const key = `profile:${slug}`;
  if (env.PROFILES_KV) {
    await env.PROFILES_KV.put(key, serialized);
  } else {
    memoryStore.set(key, serialized);
  }

  const origin = new URL(request.url).origin;
  return jsonResponse(200, {
    ok: true,
    slug,
    url: `${origin}/u/${slug}`,
    storage: env.PROFILES_KV ? "kv" : "memory",
  });
}

export async function handleGetProfileRequest(
  slug: string,
  env: PublishEnv,
): Promise<Response> {
  const found = await loadPublishedProfile(slug, env);
  if (!found) {
    return jsonResponse(404, { error: "Published TalkCV profile not found." });
  }
  return jsonResponse(200, { profile: found });
}
