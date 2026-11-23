import { getSessionUser, type AuthEnv } from "./auth";

export interface BillingEnv extends AuthEnv {
  CREEM_API_KEY?: string;
  CREEM_WEBHOOK_SECRET?: string;
  CREEM_PRO_PRODUCT_ID?: string;
  CREEM_API_BASE?: string;
}

export interface PlanRecord {
  plan: "free" | "pro";
  status: string;
  customerId?: string;
  subscriptionId?: string;
  updatedAt: string;
  expiresAt?: string;
}

export const PRO_DAILY_GENERATE_LIMIT = 30;
export const PRO_DAILY_CHAT_LIMIT_PER_SITE = 500;
export const PRO_HOSTING_DAYS = 365;
export const PRO_MAX_SITES_PER_USER = 10;

interface RedeemCodeRecord {
  code: string;
  days: number;
  maxUses: number;
  usedBy: string[];
  note?: string;
  createdAt: string;
}

const memPlans = new Map<string, string>();
const memEvents = new Set<string>();
const memCodes = new Map<string, string>();
const redeemRateBuckets = new Map<string, { count: number; resetAt: number }>();

function checkRedeemRateLimit(ip: string): boolean {
  const now = Date.now();
  const bucket = redeemRateBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    redeemRateBuckets.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (bucket.count >= 10) return false;
  bucket.count += 1;
  return true;
}

function normalizeRedeemCode(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 40);
}

function generateRandomCode(prefix = "TALKCV"): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
  return `${prefix}-${chars.slice(0, 4)}-${chars.slice(4, 8)}`;
}

async function loadRedeemCode(code: string, env: BillingEnv): Promise<RedeemCodeRecord | null> {
  const key = `redeem:${code}`;
  const raw = env.PROFILES_KV ? await env.PROFILES_KV.get(key) : (memCodes.get(key) ?? null);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RedeemCodeRecord;
  } catch {
    return null;
  }
}

async function saveRedeemCode(record: RedeemCodeRecord, env: BillingEnv): Promise<void> {
  const key = `redeem:${record.code}`;
  const serialized = JSON.stringify(record);
  if (env.PROFILES_KV) {
    await env.PROFILES_KV.put(key, serialized);
  } else {
    memCodes.set(key, serialized);
  }
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function getCreemBaseUrl(env: BillingEnv): string {
  const custom = env.CREEM_API_BASE?.trim();
  if (custom) return custom.replace(/\/+$/, "");
  const key = env.CREEM_API_KEY?.trim() || "";
  return key.startsWith("creem_test_") ? "https://test-api.creem.io" : "https://api.creem.io";
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function getUserPlan(
  email: string | undefined,
  env: BillingEnv,
): Promise<{ plan: "free" | "pro"; isPro: boolean; record: PlanRecord | null }> {
  if (!email) return { plan: "free", isPro: false, record: null };
  const key = `plan:${email.trim().toLowerCase()}`;
  const raw = env.PROFILES_KV ? await env.PROFILES_KV.get(key) : (memPlans.get(key) ?? null);
  if (!raw) return { plan: "free", isPro: false, record: null };
  try {
    const record = JSON.parse(raw) as PlanRecord;
    const isExpired =
      record.expiresAt && Number.isFinite(Date.parse(record.expiresAt)) && Date.now() > Date.parse(record.expiresAt);
    const isPro = record.plan === "pro" && !isExpired;
    return { plan: isPro ? "pro" : "free", isPro, record };
  } catch {
    return { plan: "free", isPro: false, record: null };
  }
}

export async function setUserPlan(email: string, record: PlanRecord, env: BillingEnv): Promise<void> {
  const key = `plan:${email.trim().toLowerCase()}`;
  const serialized = JSON.stringify(record);
  if (env.PROFILES_KV) {
    await env.PROFILES_KV.put(key, serialized);
  } else {
    memPlans.set(key, serialized);
  }
}

export function isBillingConfigured(env: BillingEnv): boolean {
  return Boolean(env.CREEM_API_KEY?.trim() && env.CREEM_PRO_PRODUCT_ID?.trim());
}

export async function handleBillingCheckoutRequest(request: Request, env: BillingEnv): Promise<Response> {
  if (request.method !== "POST") return jsonResponse(405, { error: "Method not allowed." });

  const user = await getSessionUser(request, env);
  if (!user) {
    return jsonResponse(401, { error: "Please sign in with your email before upgrading to Pro." });
  }

  const apiKey = env.CREEM_API_KEY?.trim();
  const productId = env.CREEM_PRO_PRODUCT_ID?.trim();
  if (!apiKey || !productId) {
    return jsonResponse(503, { error: "Billing is not configured on this server yet." });
  }

  const origin = new URL(request.url).origin;
  const baseUrl = getCreemBaseUrl(env);

  let upstream: Response;
  try {
    upstream = await fetch(`${baseUrl}/v1/checkouts`, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        product_id: productId,
        success_url: `${origin}/create?upgraded=1`,
        customer: { email: user.email },
        metadata: { email: user.email, plan: "pro" },
      }),
    });
  } catch {
    return jsonResponse(502, { error: "Unable to reach Creem checkout service." });
  }

  const data = (await upstream.json().catch(() => null)) as {
    checkout_url?: string;
    message?: string | string[];
    error?: string;
  } | null;

  if (!upstream.ok || !data?.checkout_url) {
    const msg = Array.isArray(data?.message) ? data.message.join("; ") : data?.message || data?.error;
    return jsonResponse(502, {
      error: msg || `Could not create Creem checkout session (HTTP ${upstream.status}).`,
    });
  }

  return jsonResponse(200, { ok: true, checkoutUrl: data.checkout_url });
}

export async function handleBillingPortalRequest(request: Request, env: BillingEnv): Promise<Response> {
  if (request.method !== "POST") return jsonResponse(405, { error: "Method not allowed." });

  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse(401, { error: "Please sign in first." });

  const apiKey = env.CREEM_API_KEY?.trim();
  if (!apiKey) return jsonResponse(503, { error: "Billing is not configured." });

  const { record } = await getUserPlan(user.email, env);
  if (!record?.customerId) {
    return jsonResponse(404, { error: "No active billing profile found for this account." });
  }

  const baseUrl = getCreemBaseUrl(env);
  try {
    const res = await fetch(`${baseUrl}/v1/customers/billing`, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({ customer_id: record.customerId }),
    });
    const data = (await res.json().catch(() => null)) as { customer_portal_link?: string; error?: string } | null;
    if (!res.ok || !data?.customer_portal_link) {
      return jsonResponse(502, { error: data?.error || "Could not open billing portal." });
    }
    return jsonResponse(200, { ok: true, portalUrl: data.customer_portal_link });
  } catch {
    return jsonResponse(502, { error: "Unable to reach Creem billing portal." });
  }
}

const GRANT_EVENTS = new Set([
  "checkout.completed",
  "subscription.active",
  "subscription.paid",
  "subscription.trialing",
]);

const REVOKE_EVENTS = new Set([
  "subscription.expired",
  "subscription.canceled",
  "subscription.paused",
  "refund.created",
  "dispute.created",
]);

export async function handleCreemWebhookRequest(request: Request, env: BillingEnv): Promise<Response> {
  if (request.method !== "POST") return jsonResponse(405, { error: "Method not allowed." });

  const secret = env.CREEM_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return jsonResponse(503, { error: "Webhook secret not configured." });
  }

  const signature = request.headers.get("creem-signature")?.trim() || "";
  if (!signature) {
    return jsonResponse(401, { error: "Missing creem-signature header." });
  }

  const rawBody = await request.text();
  const computed = await hmacSha256Hex(secret, rawBody);
  if (!timingSafeEqual(computed, signature)) {
    return jsonResponse(401, { error: "Invalid webhook signature." });
  }

  let payload: {
    id?: string;
    eventType?: string;
    type?: string;
    object?: {
      id?: string;
      status?: string;
      customer?: { id?: string; email?: string } | string;
      subscription?: { id?: string; current_period_end_date?: string } | string;
      metadata?: Record<string, unknown>;
      current_period_end_date?: string;
    };
  };

  try {
    payload = JSON.parse(rawBody) as typeof payload;
  } catch {
    return jsonResponse(400, { error: "Invalid JSON payload." });
  }

  const eventId = typeof payload.id === "string" ? payload.id.trim() : "";
  if (eventId) {
    const evtKey = `webhook_evt:${eventId}`;
    const seen = env.PROFILES_KV ? await env.PROFILES_KV.get(evtKey) : memEvents.has(evtKey) ? "1" : null;
    if (seen) {
      return jsonResponse(200, { ok: true, duplicate: true });
    }
    if (env.PROFILES_KV) await env.PROFILES_KV.put(evtKey, new Date().toISOString());
    else memEvents.add(evtKey);
  }

  const eventType = payload.eventType || payload.type || "";
  const obj = payload.object;
  const metaEmail = typeof obj?.metadata?.email === "string" ? obj.metadata.email.trim().toLowerCase() : "";
  const custEmail =
    obj?.customer && typeof obj.customer === "object" && typeof obj.customer.email === "string"
      ? obj.customer.email.trim().toLowerCase()
      : "";
  const email = metaEmail || custEmail;

  if (!email) {
    return jsonResponse(200, { ok: true, ignored: "no_email" });
  }

  const customerId =
    obj?.customer && typeof obj.customer === "object"
      ? obj.customer.id
      : typeof obj?.customer === "string"
        ? obj.customer
        : undefined;
  const subscriptionId =
    obj?.subscription && typeof obj.subscription === "object"
      ? obj.subscription.id
      : typeof obj?.subscription === "string"
        ? obj.subscription
        : eventType.startsWith("subscription.")
          ? obj?.id
          : undefined;
  const periodEnd =
    obj?.current_period_end_date ||
    (obj?.subscription && typeof obj.subscription === "object" ? obj.subscription.current_period_end_date : undefined);

  if (GRANT_EVENTS.has(eventType)) {
    const prev = await getUserPlan(email, env);
    await setUserPlan(
      email,
      {
        plan: "pro",
        status: "active",
        customerId: customerId || prev.record?.customerId,
        subscriptionId: subscriptionId || prev.record?.subscriptionId,
        updatedAt: new Date().toISOString(),
        ...(periodEnd ? { expiresAt: periodEnd } : {}),
      },
      env,
    );
  } else if (REVOKE_EVENTS.has(eventType)) {
    const prev = await getUserPlan(email, env);
    await setUserPlan(
      email,
      {
        plan: "free",
        status: eventType.replace("subscription.", ""),
        customerId: customerId || prev.record?.customerId,
        subscriptionId: subscriptionId || prev.record?.subscriptionId,
        updatedAt: new Date().toISOString(),
      },
      env,
    );
  }

  return jsonResponse(200, { ok: true, eventType, email });
}

export async function handleCreateRedeemCodesRequest(request: Request, env: BillingEnv): Promise<Response> {
  if (request.method !== "POST") return jsonResponse(405, { error: "Method not allowed." });

  const adminSecret = env.AUTH_SECRET?.trim() || "talkcv-dev-secret-change-in-prod";
  const authHeader = request.headers.get("authorization")?.trim() || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token || !timingSafeEqual(token, adminSecret)) {
    return jsonResponse(401, { error: "Unauthorized." });
  }

  let body: { count?: unknown; days?: unknown; maxUses?: unknown; code?: unknown; note?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body." });
  }

  const days = Math.min(3650, Math.max(1, Math.floor(Number(body.days) || 30)));
  const maxUses = Math.min(1000, Math.max(1, Math.floor(Number(body.maxUses) || 1)));
  const count = Math.min(50, Math.max(1, Math.floor(Number(body.count) || 1)));
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 120) : undefined;
  const customCode = normalizeRedeemCode(body.code);

  const created: RedeemCodeRecord[] = [];
  if (customCode) {
    const rec: RedeemCodeRecord = {
      code: customCode,
      days,
      maxUses,
      usedBy: [],
      ...(note ? { note } : {}),
      createdAt: new Date().toISOString(),
    };
    await saveRedeemCode(rec, env);
    created.push(rec);
  } else {
    for (let i = 0; i < count; i++) {
      const rec: RedeemCodeRecord = {
        code: generateRandomCode("TALKCV"),
        days,
        maxUses,
        usedBy: [],
        ...(note ? { note } : {}),
        createdAt: new Date().toISOString(),
      };
      await saveRedeemCode(rec, env);
      created.push(rec);
    }
  }

  return jsonResponse(200, {
    ok: true,
    codes: created.map((c) => ({ code: c.code, days: c.days, maxUses: c.maxUses })),
  });
}

export async function handleRedeemCodeRequest(request: Request, env: BillingEnv): Promise<Response> {
  if (request.method !== "POST") return jsonResponse(405, { error: "Method not allowed." });

  const ip =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  if (!checkRedeemRateLimit(ip)) {
    return jsonResponse(429, { error: "Too many redeem attempts. Please wait a minute and try again." });
  }

  const user = await getSessionUser(request, env);
  if (!user) {
    return jsonResponse(401, { error: "Please sign in with your email before redeeming a code." });
  }

  let body: { code?: unknown };
  try {
    body = (await request.json()) as { code?: unknown };
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body." });
  }

  const code = normalizeRedeemCode(body.code);
  if (code.length < 4) {
    return jsonResponse(400, { error: "Please enter a valid redemption code." });
  }

  const record = await loadRedeemCode(code, env);
  if (!record) {
    return jsonResponse(404, { error: "Invalid redemption code." });
  }

  const email = user.email.toLowerCase();
  if (record.usedBy.includes(email)) {
    return jsonResponse(409, { error: "You have already redeemed this code." });
  }
  if (record.usedBy.length >= record.maxUses) {
    return jsonResponse(410, { error: "This redemption code has already been used." });
  }

  const prev = await getUserPlan(email, env);
  const prevExpMs = prev.record?.expiresAt ? Date.parse(prev.record.expiresAt) : 0;
  const baseMs = prev.isPro && Number.isFinite(prevExpMs) && prevExpMs > Date.now() ? prevExpMs : Date.now();
  const nextExpiresAt = new Date(baseMs + record.days * 86400_000).toISOString();

  record.usedBy.push(email);
  await saveRedeemCode(record, env);
  await setUserPlan(
    email,
    {
      plan: "pro",
      status: "redeemed",
      customerId: prev.record?.customerId,
      subscriptionId: prev.record?.subscriptionId,
      updatedAt: new Date().toISOString(),
      expiresAt: nextExpiresAt,
    },
    env,
  );

  return jsonResponse(200, {
    ok: true,
    plan: "pro",
    isPro: true,
    dailyLimit: PRO_DAILY_GENERATE_LIMIT,
    days: record.days,
    expiresAt: nextExpiresAt,
  });
}
