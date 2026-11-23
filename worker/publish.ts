import type { PortfolioProfile } from "../lib/schema";
import {
  FREE_HOSTING_DAYS,
  getSessionUser,
  getUserSites,
  MAX_SITES_PER_USER,
  recordUserSite,
} from "./auth";

export interface KVNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

export interface PublishEnv {
  PROFILES_KV?: KVNamespaceLike;
}

interface StoredProfileRecord {
  profile: PortfolioProfile;
  ownerEmail?: string;
  createdAt: string;
  expiresAt: string;
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

async function loadStoredRecord(
  slug: string,
  env: PublishEnv,
): Promise<StoredProfileRecord | null> {
  const clean = normalizeSlug(slug);
  if (!clean) return null;
  const key = `profile:${clean}`;
  const raw = env.PROFILES_KV ? await env.PROFILES_KV.get(key) : (memoryStore.get(key) ?? null);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredProfileRecord | PortfolioProfile;
    if ("profile" in parsed && parsed.profile && typeof parsed.profile === "object") {
      return parsed as StoredProfileRecord;
    }
    return {
      profile: parsed as PortfolioProfile,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + FREE_HOSTING_DAYS * 86400_000).toISOString(),
    };
  } catch {
    return null;
  }
}

export async function loadPublishedProfile(
  slug: string,
  env: PublishEnv,
): Promise<PortfolioProfile | null> {
  const record = await loadStoredRecord(slug, env);
  return record?.profile ?? null;
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

  const user = await getSessionUser(request, env);
  const existing = await loadStoredRecord(slug, env);
  if (existing?.ownerEmail && existing.ownerEmail !== user?.email) {
    return jsonResponse(403, {
      error: `The handle "/u/${slug}" is already owned by another account. Please pick a different handle.`,
    });
  }

  if (user) {
    const userSites = await getUserSites(user.email, env);
    if (!userSites.includes(slug) && userSites.length >= MAX_SITES_PER_USER) {
      return jsonResponse(403, {
        error: `Free accounts can host up to ${MAX_SITES_PER_USER} sites (${userSites.map((s) => `/u/${s}`).join(", ")}). Update an existing handle instead.`,
      });
    }
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + FREE_HOSTING_DAYS * 86400_000).toISOString();
  const record: StoredProfileRecord = {
    profile: profileObj as PortfolioProfile,
    ...(user ? { ownerEmail: user.email } : {}),
    createdAt: existing?.createdAt ?? now.toISOString(),
    expiresAt,
  };

  const serialized = JSON.stringify(record);
  if (serialized.length > 100_000) {
    return jsonResponse(413, { error: "Profile payload is too large (max 100KB)." });
  }

  const key = `profile:${slug}`;
  if (env.PROFILES_KV) {
    await env.PROFILES_KV.put(key, serialized);
  } else {
    memoryStore.set(key, serialized);
  }

  if (user) {
    await recordUserSite(user.email, slug, env);
  }

  const origin = new URL(request.url).origin;
  return jsonResponse(200, {
    ok: true,
    slug,
    url: `${origin}/u/${slug}`,
    expiresAt,
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
