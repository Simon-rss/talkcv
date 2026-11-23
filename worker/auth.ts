import type { PublishEnv } from "./publish";

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

function getSigningSecret(env: AuthEnv): string {
  return (
    env.AUTH_SECRET?.trim() ||
    env.DEEPSEEK_API_KEY?.trim() ||
    env.OPENAI_API_KEY?.trim() ||
    "talkcv-local-dev-signing-secret"
  );
}

async function hmacHex(secret: string, message: string): Promise<string> {
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

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function parseCookies(request: Request): Record<string, string> {
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

export async function getDailyUsage(email: string, env: AuthEnv): Promise<number> {
  const key = `usage:${email}:${todayKey()}`;
  if (env.PROFILES_KV) {
    const raw = await env.PROFILES_KV.get(key);
    const num = Number(raw ?? "0");
    return Number.isFinite(num) ? num : 0;
  }
  return memUsage.get(key) ?? 0;
}

export async function incrementDailyUsage(email: string, env: AuthEnv): Promise<number> {
  const current = await getDailyUsage(email, env);
  const next = current + 1;
  const key = `usage:${email}:${todayKey()}`;
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

export async function recordUserSite(email: string, slug: string, env: AuthEnv): Promise<string[]> {
  const existing = await getUserSites(email, env);
  const next = existing.includes(slug) ? existing : [...existing, slug];
  const key = `user_sites:${email}`;
  if (env.PROFILES_KV) {
    await env.PROFILES_KV.put(key, JSON.stringify(next));
  } else {
    memUserSites.set(key, next);
  }
  return next;
}

export async function handleSendCodeRequest(request: Request, env: AuthEnv): Promise<Response> {
  if (request.method !== "POST") return jsonResponse(405, { error: "Method not allowed." });

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

  const resendKey = env.RESEND_API_KEY?.trim();
  if (resendKey) {
    const from = env.AUTH_EMAIL_FROM?.trim() || "TalkCV <onboarding@resend.dev>";
    const mailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${resendKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: `Your TalkCV login code: ${code}`,
        text: `Your TalkCV verification code is ${code}. It expires in 10 minutes.`,
      }),
    }).catch(() => null);

    if (!mailRes || !mailRes.ok) {
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

  let body: { email?: unknown; code?: unknown; challenge?: unknown };
  try {
    body = (await request.json()) as { email?: unknown; code?: unknown; challenge?: unknown };
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

  const usedToday = await getDailyUsage(email, env);
  const sites = await getUserSites(email, env);
  const isHttps = request.url.startsWith("https://");
  const cookie = `talkcv_session=${sessionValue}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${isHttps ? "; Secure" : ""}`;

  return jsonResponse(
    200,
    {
      ok: true,
      user: {
        email,
        usedToday,
        dailyLimit: DAILY_GENERATE_LIMIT,
        sites,
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
  const usedToday = await getDailyUsage(user.email, env);
  const sites = await getUserSites(user.email, env);
  return jsonResponse(200, {
    user: {
      email: user.email,
      usedToday,
      dailyLimit: DAILY_GENERATE_LIMIT,
      sites,
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
