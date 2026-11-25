import { CREDIT_COST } from "../lib/credits";
import { BoundedCooldownMap } from "../lib/rate-limit";
import { getClientIp } from "../lib/request-ip";
import { getCreditAccount } from "./credits";
import { getUserPlan, isBillingConfigured, type BillingEnv } from "./billing";
import type { PublishEnv } from "./publish";
import { bindReferralOnLogin, getOrCreateReferralRecord, isTrialActive, MAX_REFERRAL_REWARDS, type ReferralRecord } from "./referral";

export interface AuthEnv extends PublishEnv {
  RESEND_API_KEY?: string;
  AUTH_EMAIL_FROM?: string;
  AUTH_SECRET?: string;
  OPENAI_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
}

export interface SessionUser {
  email: string;
  createdAt: string;
}

export const MAX_SITES_PER_USER = 2;
export const FREE_HOSTING_DAYS = 30;

const memUserSites = new Map<string, string[]>();
const OTP_COOLDOWN_MS = 30_000;
const otpCooldown = new BoundedCooldownMap({ ttlMs: OTP_COOLDOWN_MS, maxEntries: 5000 });

function jsonResponse(status: number, body: Record<string, unknown>, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 160) return null;
  return email;
}

function randomCode(): string {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(100000 + (bytes[0] % 900000));
}

let localSigningSecret: string;

function canSendLoginCode(env: AuthEnv) {
  return !env.PROFILES_KV || Boolean(env.RESEND_API_KEY?.trim() && (
    env.AUTH_SECRET?.trim() || env.DEEPSEEK_API_KEY?.trim() || env.OPENAI_API_KEY?.trim()
  ));
}

function getSigningSecret(env: AuthEnv): string {
  return (
    env.AUTH_SECRET?.trim() ||
    env.DEEPSEEK_API_KEY?.trim() ||
    env.OPENAI_API_KEY?.trim() ||
    (localSigningSecret ??= crypto.randomUUID())
  );
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.get("cookie") ?? "";
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export async function getSessionUser(request: Request, env: AuthEnv): Promise<SessionUser | null> {
  const raw = parseCookies(request)["talkcv_session"];
  if (!raw) return null;
  const parts = raw.split("|");
  if (parts.length !== 3) return null;
  const [email, expStr, sig] = parts;
  const exp = Number(expStr);
  if (!email || !Number.isFinite(exp) || Date.now() > exp) return null;
  const expected = await hmacHex(getSigningSecret(env), `session:${email}|${expStr}`);
  if (!timingSafeEqual(sig, expected)) return null;
  return { email, createdAt: new Date(exp - 30 * 86400_000).toISOString() };
}

function usageWindowToken(period: "lifetime" | "month"): string {
  return period === "month" ? new Date().toISOString().slice(0, 7) : "lifetime";
}

export function legacyUsageCount(raw: string | null): number {
  const count = Number(raw);
  return Number.isSafeInteger(count) && count > 0 ? count : 0;
}

export async function getCookieUsage(
  request: Request,
  email: string,
  period: "lifetime" | "month",
  env: AuthEnv,
): Promise<number> {
  const raw = parseCookies(request)["talkcv_usage"];
  if (!raw) return 0;
  const parts = raw.split("|");
  if (parts.length !== 4) return 0;
  const [cEmail, cWin, cCountStr, sig] = parts;
  if (cEmail !== email || cWin !== usageWindowToken(period)) return 0;
  const expected = await hmacHex(getSigningSecret(env), `usage:${cEmail}|${cWin}|${cCountStr}`);
  if (!timingSafeEqual(sig, expected)) return 0;
  return legacyUsageCount(cCountStr);
}

export async function getDailyUsage(
  email: string,
  env: AuthEnv,
  request?: Request,
  period: "lifetime" | "month" = "lifetime",
): Promise<number> {
  const win = usageWindowToken(period);
  const key = `usage:${email}:${win}`;
  const kvCount = env.PROFILES_KV ? legacyUsageCount(await env.PROFILES_KV.get(key)) : 0;
  const cookieCount = request ? await getCookieUsage(request, email, period, env) : 0;
  return Math.max(kvCount, cookieCount);
}

export async function getUserSites(email: string, env: AuthEnv): Promise<string[]> {
  const key = `user_sites:${email}`;
  if (env.PROFILES_KV) {
    const raw = await env.PROFILES_KV.get(key);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return memUserSites.get(key) ?? [];
}

export async function updateUserSites(email: string, slug: string, add: boolean, env: AuthEnv): Promise<string[]> {
  const existing = await getUserSites(email, env);
  const next = add ? [...new Set([...existing, slug])] : existing.filter((site) => site !== slug);
  const key = `user_sites:${email}`;
  if (env.PROFILES_KV) {
    await env.PROFILES_KV.put(key, JSON.stringify(next));
  } else {
    memUserSites.set(key, next);
  }
  return next;
}

export async function sendEmail(env: AuthEnv, email: string, subject: string, text: string): Promise<boolean> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY?.trim()}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: env.AUTH_EMAIL_FROM?.trim() || "TalkCV <noreply@mytalkcv.com>",
      to: [email], subject, text,
    }),
  }).catch(() => null);
  return Boolean(response?.ok);
}

export async function handleSendCodeRequest(request: Request, env: AuthEnv): Promise<Response> {
  if (request.method !== "POST") return jsonResponse(405, { error: "Method not allowed." });

  if (!canSendLoginCode(env)) return jsonResponse(503, { error: "Email authentication is not configured." });

  let body: { email?: unknown };
  try {
    body = (await request.json()) as { email?: unknown };
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body." });
  }

  const email = normalizeEmail(body.email);
  if (!email) {
    return jsonResponse(400, { error: "Please enter a valid email address." });
  }

  const ip = getClientIp(request, env);
  const cooldownKey = `${ip}:${email}`;
  const now = Date.now();
  const memLastSent = otpCooldown.get(cooldownKey, now) ?? 0;
  let lastSent = memLastSent;
  if (env.PROFILES_KV && now - lastSent >= OTP_COOLDOWN_MS) {
    const kvRaw = await env.PROFILES_KV.get(`otp_cd:${cooldownKey}`);
    const kvTs = Number(kvRaw ?? "0");
    if (Number.isFinite(kvTs) && kvTs > lastSent) lastSent = kvTs;
  }
  if (now - lastSent < OTP_COOLDOWN_MS) {
    return jsonResponse(429, { error: "Please wait 30 seconds before requesting another code." });
  }
  otpCooldown.set(cooldownKey, now);
  if (env.PROFILES_KV) {
    await env.PROFILES_KV.put(`otp_cd:${cooldownKey}`, String(now));
  }

  const code = randomCode();
  const expiresAt = Date.now() + 10 * 60 * 1000;
  const sig = await hmacHex(getSigningSecret(env), `otp:${email}|${code}|${expiresAt}`);
  const challenge = `${expiresAt}.${sig}`;

  if (env.RESEND_API_KEY?.trim()) {
    if (!await sendEmail(env, email, `Your TalkCV login code: ${code}`, `Your TalkCV verification code is ${code}. It expires in 10 minutes.`)) {
      return jsonResponse(502, { error: "Failed to send verification email. Please try again." });
    }
    return jsonResponse(200, { ok: true, delivery: "email", challenge });
  }

  return jsonResponse(200, {
    ok: true,
    delivery: "instant",
    instantCode: code,
    challenge,
  });
}

export async function handleVerifyCodeRequest(request: Request, env: AuthEnv): Promise<Response> {
  if (request.method !== "POST") return jsonResponse(405, { error: "Method not allowed." });

  if (!canSendLoginCode(env)) return jsonResponse(503, { error: "Email authentication is not configured." });

  let body: { email?: unknown; code?: unknown; challenge?: unknown; referralCode?: unknown };
  try {
    body = (await request.json()) as { email?: unknown; code?: unknown; challenge?: unknown; referralCode?: unknown };
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body." });
  }

  const email = normalizeEmail(body.email);
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const challenge = typeof body.challenge === "string" ? body.challenge.trim() : "";
  if (!email || !/^\d{6}$/.test(code) || !challenge.includes(".")) {
    return jsonResponse(400, { error: "Valid email and 6-digit code are required." });
  }

  const [expStr, sig] = challenge.split(".");
  const expiresAt = Number(expStr);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
    return jsonResponse(401, { error: "Verification code expired. Please request a new one." });
  }

  const expected = await hmacHex(getSigningSecret(env), `otp:${email}|${code}|${expiresAt}`);
  if (!timingSafeEqual(sig, expected)) {
    return jsonResponse(401, { error: "Invalid verification code." });
  }

  const sessionExp = Date.now() + 30 * 86400_000;
  const sessionSig = await hmacHex(getSigningSecret(env), `session:${email}|${sessionExp}`);
  const sessionValue = encodeURIComponent(`${email}|${sessionExp}|${sessionSig}`);

  const existingSites = await getUserSites(email, env);
  const existingPlan = await getUserPlan(email, env as BillingEnv);
  const existingLifetimeUsage = await getDailyUsage(email, env, request, "lifetime");
  const isExistingUser =
    existingSites.length > 0 || existingLifetimeUsage > 0 || (existingPlan.isPro && !existingPlan.isTrial);

  const refRec = await bindReferralOnLogin(email, body.referralCode, env, { isExistingUser });
  const user = await sessionDetails(email, refRec, existingSites, env, request);
  const isHttps = request.url.startsWith("https://");
  const cookie = `talkcv_session=${sessionValue}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${isHttps ? "; Secure" : ""}`;

  return jsonResponse(200, { ok: true, user, credits: user.credits }, { "set-cookie": cookie });
}

async function sessionDetails(email: string, referral: ReferralRecord, sites: string[], env: AuthEnv, request: Request) {
  const { plan, credits } = await getCreditAccount(email, env, request);
  // Older clients display the equivalent number of generations or edits.
  const dailyLimit = Math.floor(credits.total / CREDIT_COST.generate);
  const editDailyLimit = plan.limits.aiLiveEdit ? Math.floor(credits.total / CREDIT_COST.edit) : 0;
  return {
    email, plan: plan.plan, isPro: plan.isPro, isMax: plan.isMax, isTrial: plan.isTrial,
    hasBilling: isBillingConfigured(env), hasBillingPortal: Boolean(plan.record?.customerId),
    maxSites: plan.limits.maxSites, sites, credits, quotaPeriod: credits.period,
    dailyLimit, usedToday: dailyLimit - Math.floor(credits.remaining / CREDIT_COST.generate),
    editDailyLimit, editUsedToday: plan.limits.aiLiveEdit ? editDailyLimit - Math.floor(credits.remaining / CREDIT_COST.edit) : 0,
    referral: {
      code: referral.code, invitedCount: referral.invitedCount, maxRewards: MAX_REFERRAL_REWARDS,
      bonusCredits: credits.bonusRemaining,
      trialExpiresAt: isTrialActive(referral) ? referral.trialExpiresAt : undefined,
      hasPendingReferrer: Boolean(referral.referredBy && !referral.qualifiedAt),
    },
  };
}

export async function handleMeRequest(request: Request, env: AuthEnv): Promise<Response> {
  const session = await getSessionUser(request, env);
  if (!session) return jsonResponse(200, { user: null, credits: null });
  const [referral, sites] = await Promise.all([getOrCreateReferralRecord(session.email, env), getUserSites(session.email, env)]);
  const user = await sessionDetails(session.email, referral, sites, env, request);
  return jsonResponse(200, { user, credits: user.credits });
}

export async function handleLogoutRequest(request: Request): Promise<Response> {
  const isHttps = request.url.startsWith("https://");
  return jsonResponse(
    200,
    { ok: true },
    {
      "set-cookie": `talkcv_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isHttps ? "; Secure" : ""}`,
    },
  );
}
