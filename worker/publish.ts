import { FREE_MODEL_IDS } from "../lib/models";
import { sanitizeDesignTokens, type PortfolioProfile } from "../lib/schema";
import {
  FREE_HOSTING_DAYS,
  getSessionUser,
  getUserSites,
  MAX_SITES_PER_USER,
  recordUserSite,
  type AuthEnv,
} from "./auth";
import { getUserPlan, PRO_HOSTING_DAYS, PRO_MAX_SITES_PER_USER, type BillingEnv } from "./billing";
import { encryptSecret, maskApiKey } from "./crypto";

export interface KVNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

export interface PublishEnv {
  PROFILES_KV?: KVNamespaceLike;
  AUTH_SECRET?: string;
  OPENAI_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
}

export interface SiteChatConfig {
  mode: "hosted" | "byok";
  hostedModelId?: string;
  byokBaseUrl?: string;
  byokModel?: string;
  byokKeyEncrypted?: string;
  byokKeyMask?: string;
}

export interface StoredProfileRecord {
  profile: PortfolioProfile;
  ownerEmail?: string;
  createdAt: string;
  expiresAt: string;
  chatConfig?: SiteChatConfig;
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

export function getEncryptionMasterKey(env: PublishEnv): string {
  return (
    env.AUTH_SECRET?.trim() ||
    env.DEEPSEEK_API_KEY?.trim() ||
    env.OPENAI_API_KEY?.trim() ||
    "talkcv-local-dev-encryption-key"
  );
}

export function normalizeSlug(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

export async function loadStoredRecord(
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

export async function handlePublishRequest(request: Request, env: AuthEnv): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed." });
  }

  let body: {
    slug?: unknown;
    profile?: unknown;
    chatConfig?: {
      mode?: unknown;
      hostedModelId?: unknown;
      byokApiKey?: unknown;
      byokBaseUrl?: unknown;
      byokModel?: unknown;
      clearByokKey?: unknown;
    };
  };
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

  // Sanitize optional designTokens before saving
  const cleanProfile: PortfolioProfile = {
    ...(profileObj as PortfolioProfile),
    designTokens: sanitizeDesignTokens(profileObj.designTokens),
  };

  const user = await getSessionUser(request, env);
  if (env.PROFILES_KV && !user) {
    return jsonResponse(401, {
      error: "Please sign in with your email before publishing a TalkCV site.",
    });
  }
  const existing = await loadStoredRecord(slug, env);
  if (existing?.ownerEmail && existing.ownerEmail !== user?.email) {
    return jsonResponse(403, {
      error: `The handle "/u/${slug}" is already owned by another account. Please pick a different handle.`,
    });
  }

  const { isPro } = await getUserPlan(user?.email, env as BillingEnv);
  const maxSites = isPro ? PRO_MAX_SITES_PER_USER : MAX_SITES_PER_USER;

  if (user) {
    const userSites = await getUserSites(user.email, env);
    if (!userSites.includes(slug) && userSites.length >= maxSites) {
      return jsonResponse(403, {
        error: `Your plan allows up to ${maxSites} sites (${userSites.map((s) => `/u/${s}`).join(", ")}). Update an existing handle instead.`,
      });
    }
  }

  // Build validated chatConfig
  const incomingChat = body.chatConfig;
  let chatConfig: SiteChatConfig = existing?.chatConfig ?? { mode: "hosted", hostedModelId: "auto" };

  if (incomingChat && typeof incomingChat === "object") {
    if (incomingChat.mode === "byok") {
      const rawKey = typeof incomingChat.byokApiKey === "string" ? incomingChat.byokApiKey.trim() : "";
      const clearKey = incomingChat.clearByokKey === true;
      const byokBaseUrl =
        typeof incomingChat.byokBaseUrl === "string" && incomingChat.byokBaseUrl.trim().startsWith("http")
          ? incomingChat.byokBaseUrl.trim().replace(/\/+$/, "")
          : existing?.chatConfig?.byokBaseUrl || "https://api.openai.com/v1";
      const byokModel =
        typeof incomingChat.byokModel === "string" && incomingChat.byokModel.trim()
          ? incomingChat.byokModel.trim().slice(0, 80)
          : existing?.chatConfig?.byokModel || "gpt-4o-mini";

      if (clearKey) {
        chatConfig = { mode: "hosted", hostedModelId: "auto" };
      } else if (rawKey) {
        const encrypted = await encryptSecret(rawKey, getEncryptionMasterKey(env));
        chatConfig = {
          mode: "byok",
          byokBaseUrl,
          byokModel,
          byokKeyEncrypted: encrypted,
          byokKeyMask: maskApiKey(rawKey),
        };
      } else if (existing?.chatConfig?.byokKeyEncrypted) {
        chatConfig = {
          mode: "byok",
          byokBaseUrl,
          byokModel,
          byokKeyEncrypted: existing.chatConfig.byokKeyEncrypted,
          byokKeyMask: existing.chatConfig.byokKeyMask,
        };
      } else {
        return jsonResponse(400, {
          error: "Please enter an API key to enable unlimited BYOK visitor chat.",
        });
      }
    } else {
      const modelId =
        typeof incomingChat.hostedModelId === "string" ? incomingChat.hostedModelId.trim() : "auto";
      if (!isPro && !FREE_MODEL_IDS.has(modelId)) {
        return jsonResponse(403, {
          error: `Model "${modelId}" requires TalkCV Pro (or switch to BYOK with your own API key).`,
        });
      }
      chatConfig = {
        mode: "hosted",
        hostedModelId: modelId,
      };
    }
  }

  const now = new Date();
  const hostingDays = isPro ? PRO_HOSTING_DAYS : FREE_HOSTING_DAYS;
  const expiresAt = new Date(now.getTime() + hostingDays * 86400_000).toISOString();
  const record: StoredProfileRecord = {
    profile: cleanProfile,
    ...(user ? { ownerEmail: user.email } : {}),
    createdAt: existing?.createdAt ?? now.toISOString(),
    expiresAt,
    chatConfig,
  };

  const serialized = JSON.stringify(record);
  if (serialized.length > 120_000) {
    return jsonResponse(413, { error: "Profile payload is too large (max 120KB)." });
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
    chatMeta: {
      mode: chatConfig.mode,
      hostedModelId: chatConfig.hostedModelId ?? "auto",
      hasByokKey: Boolean(chatConfig.byokKeyEncrypted),
      byokKeyMask: chatConfig.byokKeyMask ?? "",
      byokBaseUrl: chatConfig.byokBaseUrl ?? "",
      byokModel: chatConfig.byokModel ?? "",
    },
    storage: env.PROFILES_KV ? "kv" : "memory",
  });
}

export async function handleGetProfileRequest(
  slug: string,
  env: PublishEnv,
): Promise<Response> {
  const record = await loadStoredRecord(slug, env);
  if (!record) {
    return jsonResponse(404, { error: "Published TalkCV profile not found." });
  }
  const expTs = Date.parse(record.expiresAt);
  if (Number.isFinite(expTs) && Date.now() > expTs) {
    return jsonResponse(410, {
      error: "Hosting period expired.",
      expired: true,
      expiresAt: record.expiresAt,
    });
  }
  const cc = record.chatConfig;
  return jsonResponse(200, {
    profile: record.profile,
    expiresAt: record.expiresAt,
    chatMeta: {
      mode: cc?.mode ?? "hosted",
      hostedModelId: cc?.hostedModelId ?? "auto",
      hasByokKey: Boolean(cc?.byokKeyEncrypted),
      byokKeyMask: cc?.byokKeyMask ?? "",
      byokBaseUrl: cc?.byokBaseUrl ?? "",
      byokModel: cc?.byokModel ?? "",
    },
  });
}
