import { getMonthlyEditUsage, getUserPlan, isBillingConfigured, type BillingEnv } from "./billing";
import type { PublishEnv } from "./publish";
import { bindReferralOnLogin, getOrCreateReferralRecord, isTrialActive, MAX_REFERRAL_REWARDS } from "./referral";

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

export const DAILY_GENERATE_LIMIT = 3;
export const MAX_SITES_PER_USER = 2;
export const FREE_HOSTING_DAYS = 30;

const memUsage = new Map<string, number>();
const memUserSites = new Map<string, string[]>();
const otpCooldown = new Map<string, number>();
const OTP_COOLDOWN_MS = 30_000;

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

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
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

async function getCookieUsage(
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
  const count = Number(cCountStr);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

export async function buildUsageCookie(
  request: Request,
  email: string,
  count: number,
  env: AuthEnv,
  period: "lifetime" | "month" = "lifetime",
): Promise<string> {
  const win = usageWindowToken(period);
  const sig = await hmacHex(getSigningSecret(env), `usage:${email}|${win}|${count}`);
  const val = encodeURIComponent(`${email}|${win}|${count}|${sig}`);
  const isHttps = request.url.startsWith("https://");
  const maxAge = period === "lifetime" ? 31536000 : 2678400;
  return `talkcv_usage=${val}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isHttps ? "; Secure" : ""}`;
}

export async function getDailyUsage(
  email: string,
  env: AuthEnv,
  request?: Request,
  period: "lifetime" | "month" = "lifetime",
): Promise<number> {
  const win = usageWindowToken(period);
  const key = `usage:${email}:${win}`;
  let kvCount = 0;
  if (env.PROFILES_KV) {
    const raw = await env.PROFILES_KV.get(key);
    const num = Number(raw ?? "0");
    kvCount = Number.isFinite(num) ? num : 0;
  } else {
    kvCount = memUsage.get(key) ?? 0;
  }
  const cookieCount = request ? await getCookieUsage(request, email, period, env) : 0;
  return Math.max(kvCount, cookieCount);
}

export async function incrementDailyUsage(
  email: string,
  env: AuthEnv,
  request?: Request,
  period: "lifetime" | "month" = "lifetime",
): Promise<number> {
  const current = await getDailyUsage(email, env, request, period);
  const next = current + 1;
  const win = usageWindowToken(period);
  const key = `usage:${email}:${win}`;
  if (env.PROFILES_KV) {
    await env.PROFILES_KV.put(key, String(next));
  } else {
    memUsage.set(key, next);
  }
  return next;
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
      from: env.AUTH_EMAIL_FROM?.trim() || "TalkCV <onboarding@resend.dev>",
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

  const ip =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "local";
  const cooldownKey = `${ip}:${email}`;
  const lastSent = otpCooldown.get(cooldownKey) ?? 0;
  if (Date.now() - lastSent < OTP_COOLDOWN_MS) {
    return jsonResponse(429, { error: "Please wait 30 seconds before requesting another code." });
  }
  otpCooldown.set(cooldownKey, Date.now());

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
  const { plan, isPro, isMax, isTrial, limits, baseLimits, bonusGenerates, bonusEdits, record } = await getUserPlan(
    email,
    env as BillingEnv,
  );
  const usedToday = await getDailyUsage(email, env, request, limits.generatePeriod);
  const editUsedToday = isTrial ? 0 : await getMonthlyEditUsage(email, env as BillingEnv);
  const effectiveDailyLimit = Math.max(baseLimits.generateLimit, usedToday) + bonusGenerates;
  const effectiveEditLimit = Math.max(isTrial ? 0 : baseLimits.editLimit, editUsedToday) + bonusEdits;
  const sites = existingSites;
  const isHttps = request.url.startsWith("https://");
  const cookie = `talkcv_session=${sessionValue}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${isHttps ? "; Secure" : ""}`;

  return jsonResponse(
    200,
    {
      ok: true,
      user: {
        email,
        plan,
        isPro,
        isMax,
        isTrial,
        hasBilling: isBillingConfigured(env as BillingEnv),
        hasBillingPortal: Boolean(record?.customerId),
        maxSites: limits.maxSites,
        usedToday,
        dailyLimit: effectiveDailyLimit,
        quotaPeriod: limits.generatePeriod,
        editUsedToday,
        editDailyLimit: effectiveEditLimit,
        sites,
        referral: {
          code: refRec.code,
          invitedCount: refRec.invitedCount,
          maxRewards: MAX_REFERRAL_REWARDS,
          bonusGenerates: refRec.bonusGenerates,
          bonusEdits: refRec.bonusEdits,
          trialExpiresAt: isTrialActive(refRec) ? refRec.trialExpiresAt : undefined,
          hasPendingReferrer: Boolean(refRec.referredBy && !refRec.qualifiedAt),
        },
      },
    },
    { "set-cookie": cookie },
  );
}

export async function handleMeRequest(request: Request, env: AuthEnv): Promise<Response> {
  const user = await getSessionUser(request, env);
  if (!user) {
    return jsonResponse(200, { user: null });
  }
  const refRec = await getOrCreateReferralRecord(user.email, env);
  const { plan, isPro, isMax, isTrial, limits, baseLimits, bonusGenerates, bonusEdits, record } = await getUserPlan(
    user.email,
    env as BillingEnv,
  );
  const usedToday = await getDailyUsage(user.email, env, request, limits.generatePeriod);
  const editUsedToday = isTrial ? 0 : await getMonthlyEditUsage(user.email, env as BillingEnv);
  const effectiveDailyLimit = Math.max(baseLimits.generateLimit, usedToday) + bonusGenerates;
  const effectiveEditLimit = Math.max(isTrial ? 0 : baseLimits.editLimit, editUsedToday) + bonusEdits;
  const sites = await getUserSites(user.email, env);
  return jsonResponse(200, {
    user: {
      email: user.email,
      plan,
      isPro,
      isMax,
      isTrial,
      hasBilling: isBillingConfigured(env as BillingEnv),
      hasBillingPortal: Boolean(record?.customerId),
      maxSites: limits.maxSites,
      usedToday,
      dailyLimit: effectiveDailyLimit,
      quotaPeriod: limits.generatePeriod,
      editUsedToday,
      editDailyLimit: effectiveEditLimit,
      sites,
      referral: {
        code: refRec.code,
        invitedCount: refRec.invitedCount,
        maxRewards: MAX_REFERRAL_REWARDS,
        bonusGenerates: refRec.bonusGenerates,
        bonusEdits: refRec.bonusEdits,
        trialExpiresAt: isTrialActive(refRec) ? refRec.trialExpiresAt : undefined,
        hasPendingReferrer: Boolean(refRec.referredBy && !refRec.qualifiedAt),
      },
    },
  });
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
