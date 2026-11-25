import { deleteSiteTraffic } from "./insights";
import { deleteLeads } from "./leads";
import { normalizeContacts } from "../lib/contacts.mjs";
import { canUseModel } from "../lib/models";
import { getClientIp, type RequestIpEnv } from "../lib/request-ip";
import {
  AI_BRIEF_LIMITS,
  normalizeSlug,
  sanitizeCoverImage,
  sanitizeCustomHtml,
  sanitizeDesignTokens,
  sanitizeLayoutPlan,
  type AiBrief,
  type PortfolioProfile,
} from "../lib/schema";
import {
  FREE_HOSTING_DAYS,
  getSessionUser,
  getUserSites,
  updateUserSites,
  type SessionUser,
  type AuthEnv,
} from "./auth";
import { getUserPlan, type BillingEnv } from "./billing";
import { resolveExternalOrigin, type ExternalMountEnv } from "./external-mount";
import { getOrCreateReferralRecord, qualifyReferralOnPublish } from "./referral";
import { hashPasscode, siteUnlocked, validPasscode, type PasscodeHash } from "./site-access";
import { encryptSecret, maskApiKey } from "./crypto";

export interface KVNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  list?(options: { prefix: string; cursor?: string }): Promise<{
    keys: { name: string }[]; list_complete: boolean; cursor?: string;
  }>;
  listPrefix?(prefix: string, limit?: number): Promise<Array<{ key: string; value: string; updatedAt?: string }>>;
  withSiteWrite?<T>(slug: string, email: string, operation: (store: KVNamespaceLike) => Promise<T>): Promise<T>;
}

export interface PublishEnv extends RequestIpEnv {
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

function chatMetadata(config?: SiteChatConfig) {
  return {
    mode: config?.mode ?? "hosted",
    hostedModelId: config?.hostedModelId ?? "auto",
    hasByokKey: Boolean(config?.byokKeyEncrypted),
    byokKeyMask: config?.byokKeyMask ?? "",
    byokBaseUrl: config?.byokBaseUrl ?? "",
    byokModel: config?.byokModel ?? "",
  };
}

export interface StoredProfileRecord {
  profile: PortfolioProfile;
  aiBrief?: AiBrief;
  ownerEmail?: string;
  ownerRefCode?: string;
  createdAt: string;
  expiresAt: string;
  chatConfig?: SiteChatConfig;
  noindex?: boolean;
  passcode?: PasscodeHash;
  externalOrigin?: string;
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
const MAX_PROFILE_BYTES = 2_000_000;
const payloadTooLarge = () => jsonResponse(413, { error: "Profile payload is too large (max 2MB)." });

interface StoredProfileMedia {
  avatar?: string;
  projectCovers?: Record<string, string>;
}

const MEDIA_REF_AVATAR = "__media__:avatar";
const MEDIA_REF_COVER_PREFIX = "__media__:cover:";

function extractProfileMedia(profile: PortfolioProfile): {
  lightweightProfile: PortfolioProfile;
  media: StoredProfileMedia | null;
} {
  let avatar: string | undefined;
  let nextBasics = profile.basics;
  if (typeof profile.basics?.avatar === "string" && profile.basics.avatar.startsWith("data:image/")) {
    avatar = profile.basics.avatar;
    nextBasics = { ...profile.basics, avatar: MEDIA_REF_AVATAR };
  }

  const projectCovers: Record<string, string> = {};
  let hasCoverMedia = false;
  const nextProjects = Array.isArray(profile.projects)
    ? profile.projects.map((p, idx) => {
        if (typeof p?.coverImage === "string" && p.coverImage.startsWith("data:image/")) {
          const refKey = p.slug || String(idx);
          projectCovers[refKey] = p.coverImage;
          hasCoverMedia = true;
          return { ...p, coverImage: `${MEDIA_REF_COVER_PREFIX}${refKey}` };
        }
        return p;
      })
    : [];

  if (!avatar && !hasCoverMedia) {
    return { lightweightProfile: profile, media: null };
  }
  return {
    lightweightProfile: { ...profile, basics: nextBasics, projects: nextProjects },
    media: {
      ...(avatar ? { avatar } : {}),
      ...(hasCoverMedia ? { projectCovers } : {}),
    },
  };
}

function hydrateProfileMedia(profile: PortfolioProfile, media: StoredProfileMedia | null, includeMedia: boolean): PortfolioProfile {
  const basicsAvatar = profile.basics?.avatar;
  let nextBasics = profile.basics;
  if (basicsAvatar === MEDIA_REF_AVATAR) {
    nextBasics = {
      ...profile.basics,
      avatar: includeMedia ? media?.avatar : undefined,
    };
  } else if (!includeMedia && typeof basicsAvatar === "string" && basicsAvatar.startsWith("data:image/")) {
    nextBasics = { ...profile.basics, avatar: undefined };
  }

  const nextProjects = Array.isArray(profile.projects)
    ? profile.projects.map((p, idx) => {
        const cov = p?.coverImage;
        if (typeof cov === "string" && cov.startsWith(MEDIA_REF_COVER_PREFIX)) {
          const refKey = cov.slice(MEDIA_REF_COVER_PREFIX.length) || p.slug || String(idx);
          return {
            ...p,
            coverImage: includeMedia ? media?.projectCovers?.[refKey] : undefined,
          };
        }
        if (!includeMedia && typeof cov === "string" && cov.startsWith("data:image/")) {
          return { ...p, coverImage: undefined };
        }
        return p;
      })
    : [];

  return { ...profile, basics: nextBasics, projects: nextProjects };
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store" },
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

export async function loadStoredRecord(
  slug: string,
  env: PublishEnv,
  options: { includeMedia?: boolean } = {},
): Promise<StoredProfileRecord | null> {
  const clean = normalizeSlug(slug);
  if (!clean) return null;
  const includeMedia = options.includeMedia !== false;
  const key = `profile:${clean}`;
  const mediaKey = `profile_media:${clean}`;
  const raw = env.PROFILES_KV ? await env.PROFILES_KV.get(key) : (memoryStore.get(key) ?? null);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredProfileRecord | PortfolioProfile;
    const record: StoredProfileRecord =
      "profile" in parsed && parsed.profile && typeof parsed.profile === "object"
        ? (parsed as StoredProfileRecord)
        : {
            profile: parsed as PortfolioProfile,
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + FREE_HOSTING_DAYS * 86400_000).toISOString(),
          };
    const needsMedia =
      includeMedia &&
      (record.profile.basics?.avatar === MEDIA_REF_AVATAR ||
        (Array.isArray(record.profile.projects) &&
          record.profile.projects.some(
            (p) => typeof p?.coverImage === "string" && p.coverImage.startsWith(MEDIA_REF_COVER_PREFIX),
          )));
    let media: StoredProfileMedia | null = null;
    if (needsMedia) {
      const rawMedia = env.PROFILES_KV ? await env.PROFILES_KV.get(mediaKey) : (memoryStore.get(mediaKey) ?? null);
      if (rawMedia) {
        try {
          media = JSON.parse(rawMedia) as StoredProfileMedia;
        } catch {
          media = null;
        }
      }
    }
    return {
      ...record,
      profile: hydrateProfileMedia(record.profile, media, includeMedia),
    };
  } catch {
    return null;
  }
}

interface PublishBody {
  slug?: unknown;
  profile?: unknown;
  aiBrief?: unknown;
  privacy?: { noindex?: boolean; protected?: boolean; passcode?: string };
  chatConfig?: {
    mode?: unknown;
    hostedModelId?: unknown;
    byokApiKey?: unknown;
    byokBaseUrl?: unknown;
    byokModel?: unknown;
    clearByokKey?: unknown;
  };
}

// PostgreSQL locks both the handle and the account quota across server instances.
let localWrite = Promise.resolve();
export function withSiteWrite<T>(slug: string, email: string, env: AuthEnv, operation: (env: AuthEnv) => Promise<T>) {
  if (env.PROFILES_KV?.withSiteWrite) {
    return env.PROFILES_KV.withSiteWrite(slug, email, (store) => operation({ ...env, PROFILES_KV: store }));
  }
  const result = localWrite.then(() => operation(env));
  localWrite = result.then(() => {}, () => {});
  return result;
}

export async function handlePublishRequest(request: Request, env: AuthEnv): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed." });
  }

  if (!request.body) return jsonResponse(400, { error: "Invalid JSON body." });
  if (Number(request.headers.get("content-length")) > MAX_PROFILE_BYTES) return payloadTooLarge();
  const reader = request.body.getReader();
  let body: PublishBody;
  try {
    let bytes = 0;
    let text = "";
    const decoder = new TextDecoder();
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_PROFILE_BYTES) {
        await reader.cancel();
        return payloadTooLarge();
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    body = JSON.parse(text + decoder.decode());
    if (!body || typeof body !== "object") return jsonResponse(400, { error: "Invalid JSON body." });
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body." });
  } finally {
    reader.releaseLock();
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

  const contacts = normalizeContacts(profileObj.basics);
  if ("aiBrief" in profileObj) {
    return jsonResponse(400, { error: "Send the private AI brief separately from the public profile." });
  }
  for (const key of Object.keys(contacts) as (keyof typeof contacts)[]) {
    if (profileObj.basics[key] && !contacts[key]) {
      return jsonResponse(400, { error: "Check the email address and contact links before publishing." });
    }
  }

  const sanitizedProjects = Array.isArray(profileObj.projects)
    ? profileObj.projects.map((p) => {
        const cleanCover = sanitizeCoverImage(p?.coverImage);
        return cleanCover ? { ...p, coverImage: cleanCover } : { ...p, coverImage: undefined };
      })
    : [];
  const cleanCustomHtml = sanitizeCustomHtml(profileObj.customHtml);
  const cleanRenderMode = profileObj.renderMode === "custom" && cleanCustomHtml ? "custom" : "structured";

  const cleanProfile: PortfolioProfile = {
    ...(profileObj as PortfolioProfile),
    basics: { ...profileObj.basics, ...contacts },
    projects: sanitizedProjects,
    designTokens: sanitizeDesignTokens(profileObj.designTokens),
    layoutPlan: sanitizeLayoutPlan(profileObj.layoutPlan),
    renderMode: cleanRenderMode,
    ...(cleanCustomHtml ? { customHtml: cleanCustomHtml } : { customHtml: undefined }),
  };

  const user = await getSessionUser(request, env);
  if (!user && (env.PROFILES_KV || body.privacy?.protected || body.privacy?.noindex || body.aiBrief !== undefined)) {
    return jsonResponse(401, {
      error: "Please sign in with your email before publishing a TalkCV site.",
    });
  }
  const clientIp = getClientIp(request, env);
  const result = await withSiteWrite(slug, user?.email ?? "", env, (lockedEnv) =>
    saveProfile(slug, cleanProfile, body, user, new URL(request.url).origin, lockedEnv));
  if (!result.ok) return result.response;

  let referralReward: { credits: number; trialDays: number; inviterRewarded: boolean } | undefined;
  if (user) {
    const qualified = await qualifyReferralOnPublish(user.email, clientIp, env, result.isFirstSite);
    if (qualified.rewarded) referralReward = qualified.inviteeBonus;
  }

  return jsonResponse(200, {
    ...result.payload,
    ...(referralReward ? { referralReward } : {}),
  });
}

async function saveProfile(
  slug: string,
  cleanProfile: PortfolioProfile,
  body: PublishBody,
  user: SessionUser | null,
  origin: string,
  env: AuthEnv,
): Promise<
  | { ok: false; response: Response }
  | { ok: true; isFirstSite: boolean; payload: Record<string, unknown> }
> {
  const existing = await loadStoredRecord(slug, env);
  if (existing?.ownerEmail && existing.ownerEmail !== user?.email) {
    return {
      ok: false,
      response: jsonResponse(403, {
        error: `The handle "/u/${slug}" is already owned by another account. Please pick a different handle.`,
      }),
    };
  }

  const { plan, limits } = await getUserPlan(user?.email, env as BillingEnv);
  const maxSites = limits.maxSites;
  // White-label (hideBranding) is exclusive to Max plan
  const finalProfile: PortfolioProfile = {
    ...cleanProfile,
    hideBranding: plan === "max" && Boolean(cleanProfile.hideBranding),
  };

  let priorSiteCount = 0;
  if (user) {
    const userSites = await getUserSites(user.email, env);
    priorSiteCount = userSites.length;
    if (!userSites.includes(slug) && userSites.length >= maxSites) {
      return {
        ok: false,
        response: jsonResponse(403, {
          error: `Your plan allows up to ${maxSites} sites (${userSites.map((s) => `/u/${s}`).join(", ")}). Update an existing handle instead.`,
        }),
      };
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
        return {
          ok: false,
          response: jsonResponse(400, {
            error: "Please enter an API key to enable unlimited BYOK visitor chat.",
          }),
        };
      }
    } else {
      const modelId =
        typeof incomingChat.hostedModelId === "string" ? incomingChat.hostedModelId.trim() : "auto";
      if (!canUseModel(modelId, plan)) {
        return {
          ok: false,
          response: jsonResponse(403, {
            error: `Model "${modelId}" requires TalkCV Pro or Max (or switch to BYOK with your own API key).`,
          }),
        };
      }
      chatConfig = {
        mode: "hosted",
        hostedModelId: modelId,
      };
    }
  }

  const privacy = body.privacy;
  let aiBrief = existing?.aiBrief;
  if (body.aiBrief !== undefined) {
    const input = body.aiBrief;
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return { ok: false, response: jsonResponse(400, { error: "Invalid AI brief." }) };
    }
    const clean: AiBrief = {};
    for (const [field, value] of Object.entries(input)) {
      const key = field as keyof AiBrief;
      if (!Object.hasOwn(AI_BRIEF_LIMITS, key) || typeof value !== "string" || value.length > AI_BRIEF_LIMITS[key]) {
        return { ok: false, response: jsonResponse(400, { error: "Invalid AI brief field or length." }) };
      }
      if (value.trim()) clean[key] = value.trim();
    }
    aiBrief = Object.keys(clean).length ? clean : undefined;
  }
  let passcode = existing?.passcode;
  if (privacy?.protected === false) passcode = undefined;
  if (privacy?.protected === true && (privacy.passcode || !passcode)) {
    if (!validPasscode(privacy.passcode)) {
      return {
        ok: false,
        response: jsonResponse(400, { error: "Use a passcode of 4 to 8 letters or digits." }),
      };
    }
    passcode = await hashPasscode(privacy.passcode);
  }
  const now = new Date();
  const hostingDays = limits.hostingDays;
  const expiresAt = new Date(now.getTime() + hostingDays * 86400_000).toISOString();
  const ownerRef = user ? await getOrCreateReferralRecord(user.email, env) : null;
  const { lightweightProfile, media } = extractProfileMedia(finalProfile);
  const record: StoredProfileRecord = {
    profile: lightweightProfile,
    aiBrief,
    noindex: privacy?.noindex ?? existing?.noindex ?? false,
    passcode,
    ...(user ? { ownerEmail: user.email, ownerRefCode: ownerRef?.code } : {}),
    ...(existing?.externalOrigin ? { externalOrigin: existing.externalOrigin } : {}),
    createdAt: existing?.createdAt ?? now.toISOString(),
    expiresAt,
    chatConfig,
  };

  const serialized = JSON.stringify(record);
  const serializedMedia = media ? JSON.stringify(media) : "";
  if (new TextEncoder().encode(serialized).length + new TextEncoder().encode(serializedMedia).length > MAX_PROFILE_BYTES) {
    return { ok: false, response: payloadTooLarge() };
  }

  const key = `profile:${slug}`;
  const mediaKey = `profile_media:${slug}`;
  if (env.PROFILES_KV) {
    await env.PROFILES_KV.put(key, serialized);
    if (media) await env.PROFILES_KV.put(mediaKey, serializedMedia);
    else await env.PROFILES_KV.delete(mediaKey);
  } else {
    memoryStore.set(key, serialized);
    if (media) memoryStore.set(mediaKey, serializedMedia);
    else memoryStore.delete(mediaKey);
  }

  if (user) {
    await updateUserSites(user.email, slug, true, env);
  }

  return {
    ok: true,
    isFirstSite: !existing && priorSiteCount === 0,
    payload: {
      ok: true,
      slug,
      url: `${origin}/u/${slug}`,
      expiresAt,
      privacy: { noindex: Boolean(record.noindex), protected: Boolean(record.passcode) },
      chatMeta: chatMetadata(chatConfig),
      storage: env.PROFILES_KV ? "kv" : "memory",
    },
  };
}

export async function handleDeleteProfileRequest(request: Request, rawSlug: string, env: AuthEnv) {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse(401, { error: "Sign in to delete a site." });
  const slug = normalizeSlug(rawSlug);
  return withSiteWrite(slug, user.email, env, async (lockedEnv) => {
    const record = await loadStoredRecord(slug, lockedEnv);
    if (!record) return jsonResponse(404, { error: "Published TalkCV profile not found." });
    if (record.ownerEmail !== user.email) return jsonResponse(403, { error: "Only the site owner can delete it." });
    if (lockedEnv.PROFILES_KV) {
      await lockedEnv.PROFILES_KV.delete(`profile:${slug}`);
      await lockedEnv.PROFILES_KV.delete(`profile_media:${slug}`);
    } else {
      memoryStore.delete(`profile:${slug}`);
      memoryStore.delete(`profile_media:${slug}`);
    }
    await deleteSiteTraffic(slug, lockedEnv);
    await deleteLeads(slug, lockedEnv);
    const sites = await updateUserSites(user.email, slug, false, lockedEnv);
    return jsonResponse(200, { sites });
  });
}

export async function handleGetProfileRequest(
  request: Request, slug: string,
  env: PublishEnv,
): Promise<Response> {
  const record = await loadStoredRecord(slug, env);
  if (!record) {
    return jsonResponse(404, { error: "Published TalkCV profile not found." });
  }
  const editing = new URL(request.url).searchParams.get("edit") === "1";
  if (editing) {
    const user = await getSessionUser(request, env);
    if (!user || user.email !== record.ownerEmail) return jsonResponse(403, { error: "Owner access required." });
  } else if (!await siteUnlocked(request, normalizeSlug(slug), record.passcode)) {
    return jsonResponse(401, { locked: true });
  }
  const expTs = Date.parse(record.expiresAt);
  const ownerPlan = record.ownerEmail
    ? await getUserPlan(record.ownerEmail, env as BillingEnv)
    : { isPro: false, isTrial: false };
  const hasPermanentHosting = ownerPlan.isPro && !ownerPlan.isTrial;
  const expired = !hasPermanentHosting && Number.isFinite(expTs) && Date.now() > expTs;
  const aiDormant = Boolean(expired && record.chatConfig?.mode !== "byok");
  const ownerRefCode =
    record.ownerRefCode ||
    (record.ownerEmail ? (await getOrCreateReferralRecord(record.ownerEmail, env)).code : undefined);
  const publicProfile = { ...record.profile };
  if ("aiBrief" in publicProfile) delete publicProfile.aiBrief;
  const externalOrigin = resolveExternalOrigin(normalizeSlug(slug), record, env as ExternalMountEnv);
  return jsonResponse(200, {
    profile: publicProfile,
    ...(editing && record.aiBrief ? { aiBrief: record.aiBrief } : {}),
    ...(externalOrigin ? { externalOrigin } : {}),
    expiresAt: record.expiresAt,
    aiDormant,
    ...(ownerRefCode ? { ownerRefCode } : {}),
    chatMeta: chatMetadata(record.chatConfig),
    ...(editing && { privacy: { noindex: Boolean(record.noindex), protected: Boolean(record.passcode) } }),
  });
}
