import type { PublishEnv } from "./publish";

export interface AuthEnv extends PublishEnv {
  RESEND_API_KEY?: string;
  AUTH_EMAIL_FROM?: string;
}

export interface SessionUser {
  email: string;
  createdAt: string;
}

export const DAILY_GENERATE_LIMIT = 3;
export const MAX_SITES_PER_USER = 2;
export const FREE_HOSTING_DAYS = 30;

const memOtp = new Map<string, { code: string; expiresAt: number }>();
const memSession = new Map<string, SessionUser>();
const memUsage = new Map<string, number>();

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

function randomToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
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
  const token = parseCookies(request)["talkcv_session"];
  if (!token || token.length < 24) return null;
  const key = `session:${token}`;
  if (env.PROFILES_KV) {
    const raw = await env.PROFILES_KV.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as SessionUser;
    } catch {
      return null;
    }
  }
  return memSession.get(key) ?? null;
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
  const raw = env.PROFILES_KV ? await env.PROFILES_KV.get(key) : null;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export async function recordUserSite(email: string, slug: string, env: AuthEnv): Promise<string[]> {
  const existing = await getUserSites(email, env);
  const next = existing.includes(slug) ? existing : [...existing, slug];
  if (env.PROFILES_KV) {
    await env.PROFILES_KV.put(`user_sites:${email}`, JSON.stringify(next));
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

  const code = randomCode();
  const expiresAt = Date.now() + 10 * 60 * 1000;
  const key = `otp:${email}`;
  if (env.PROFILES_KV) {
    await env.PROFILES_KV.put(key, JSON.stringify({ code, expiresAt }));
  } else {
    memOtp.set(key, { code, expiresAt });
  }

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
    return jsonResponse(200, { ok: true, delivery: "email" });
  }

  // Graceful instant-code mode when RESEND_API_KEY is not configured yet
  return jsonResponse(200, {
    ok: true,
    delivery: "instant",
    instantCode: code,
  });
}

export async function handleVerifyCodeRequest(request: Request, env: AuthEnv): Promise<Response> {
  if (request.method !== "POST") return jsonResponse(405, { error: "Method not allowed." });

  let body: { email?: unknown; code?: unknown };
  try {
    body = (await request.json()) as { email?: unknown; code?: unknown };
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body." });
  }

  const email = normalizeEmail(body.email);
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!email || !/^\d{6}$/.test(code)) {
    return jsonResponse(400, { error: "Valid email and 6-digit code are required." });
  }

  const key = `otp:${email}`;
  let stored: { code: string; expiresAt: number } | null = null;
  if (env.PROFILES_KV) {
    const raw = await env.PROFILES_KV.get(key);
    if (raw) {
      try {
        stored = JSON.parse(raw) as { code: string; expiresAt: number };
      } catch {
        stored = null;
      }
    }
  } else {
    stored = memOtp.get(key) ?? null;
  }

  if (!stored || stored.code !== code || Date.now() > stored.expiresAt) {
    return jsonResponse(401, { error: "Invalid or expired verification code." });
  }

  const token = randomToken();
  const session: SessionUser = { email, createdAt: new Date().toISOString() };
  if (env.PROFILES_KV) {
    await env.PROFILES_KV.put(`session:${token}`, JSON.stringify(session));
  } else {
    memSession.set(`session:${token}`, session);
  }

  const usedToday = await getDailyUsage(email, env);
  const sites = await getUserSites(email, env);
  const isHttps = request.url.startsWith("https://");
  const cookie = `talkcv_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${isHttps ? "; Secure" : ""}`;

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
