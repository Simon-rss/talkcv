import { CREDIT_COST, PLAN_CREDITS } from "../lib/credits";
import { getCredits } from "./credits";
import { withSiteWrite } from "./publish";
import type { PlanTier } from "../lib/models";
import { getSessionUser, type AuthEnv } from "./auth";
import { isTrialActive, readReferralRecord, referralCreditGrant } from "./referral";

export interface BillingEnv extends AuthEnv {
  CREEM_API_KEY?: string;
  CREEM_WEBHOOK_SECRET?: string;
  CREEM_PRO_PRODUCT_ID?: string;
  CREEM_PRO_YEARLY_PRODUCT_ID?: string;
  CREEM_MAX_PRODUCT_ID?: string;
  CREEM_MAX_YEARLY_PRODUCT_ID?: string;
  CREEM_PRO_ONETIME_PRODUCT_ID?: string;
  CREEM_PRO_YEARLY_ONETIME_PRODUCT_ID?: string;
  CREEM_MAX_ONETIME_PRODUCT_ID?: string;
  CREEM_MAX_YEARLY_ONETIME_PRODUCT_ID?: string;
  CREEM_API_BASE?: string;
}

export interface PlanRecord {
  plan: PlanTier;
  status: string;
  customerId?: string;
  subscriptionId?: string;
  updatedAt: string;
  expiresAt?: string;
}

export interface PlanLimits {
  dailyChatLimitPerSite: number;
  hostingDays: number;
  maxSites: number;
  aiLiveEdit: boolean;
}

export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  free: {
    dailyChatLimitPerSite: 30,
    hostingDays: 30,
    maxSites: 2,
    aiLiveEdit: false,
  },
  pro: {
    dailyChatLimitPerSite: 200,
    hostingDays: 365,
    maxSites: 10,
    aiLiveEdit: true,
  },
  max: {
    dailyChatLimitPerSite: 600,
    hostingDays: 365,
    maxSites: 30,
    aiLiveEdit: true,
  },
};

export interface RedeemCodeRecord {
  code: string;
  plan?: PlanTier;
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
): Promise<{
  plan: PlanTier;
  isPro: boolean;
  isMax: boolean;
  isTrial: boolean;
  limits: PlanLimits;
  rewardCredits: number;
  record: PlanRecord | null;
}> {
  if (!email) {
    return {
      plan: "free",
      isPro: false,
      isMax: false,
      isTrial: false,
      limits: PLAN_LIMITS.free,
      rewardCredits: 0,
      record: null,
    };
  }
  const key = `plan:${email.trim().toLowerCase()}`;
  const raw = env.PROFILES_KV ? await env.PROFILES_KV.get(key) : (memPlans.get(key) ?? null);
  const refRec = await readReferralRecord(email, env);
  const rewardCredits = referralCreditGrant(refRec);
  const trialOn = isTrialActive(refRec);

  let record: PlanRecord | null = null;
  let paidPlan: PlanTier = "free";
  if (raw) {
    try {
      record = JSON.parse(raw) as PlanRecord;
      const isExpired =
        record.expiresAt && Number.isFinite(Date.parse(record.expiresAt)) && Date.now() > Date.parse(record.expiresAt);
      if (!isExpired && (record.plan === "max" || record.plan === "pro")) {
        paidPlan = record.plan;
      }
    } catch {
      record = null;
    }
  }

  const isTrial = paidPlan === "free" && trialOn;
  return {
    plan: isTrial ? "pro" : paidPlan,
    isPro: paidPlan !== "free" || isTrial,
    isMax: paidPlan === "max",
    isTrial,
    limits: isTrial ? { ...PLAN_LIMITS.free, aiLiveEdit: true } : PLAN_LIMITS[paidPlan],
    rewardCredits,
    record,
  };
}

export async function setUserPlan(email: string, record: PlanRecord, env: BillingEnv): Promise<void> {
  const normalized = email.trim().toLowerCase();
  await withSiteWrite("", normalized, env, async (locked) => {
    const key = `plan:${normalized}`;
    const serialized = JSON.stringify(record);
    if (locked.PROFILES_KV) await locked.PROFILES_KV.put(key, serialized);
    else memPlans.set(key, serialized);
  });
}

function billingProducts(env: BillingEnv, mode: "subscription" | "onetime" = "subscription") {
  if (mode === "onetime") {
    return {
      pro: {
        month: env.CREEM_PRO_ONETIME_PRODUCT_ID?.trim() || env.CREEM_PRO_PRODUCT_ID?.trim(),
        year: env.CREEM_PRO_YEARLY_ONETIME_PRODUCT_ID?.trim() || env.CREEM_PRO_YEARLY_PRODUCT_ID?.trim(),
      },
      max: {
        month: env.CREEM_MAX_ONETIME_PRODUCT_ID?.trim() || env.CREEM_MAX_PRODUCT_ID?.trim(),
        year: env.CREEM_MAX_YEARLY_ONETIME_PRODUCT_ID?.trim() || env.CREEM_MAX_YEARLY_PRODUCT_ID?.trim(),
      },
    };
  }
  return {
    pro: { month: env.CREEM_PRO_PRODUCT_ID?.trim(), year: env.CREEM_PRO_YEARLY_PRODUCT_ID?.trim() },
    max: { month: env.CREEM_MAX_PRODUCT_ID?.trim(), year: env.CREEM_MAX_YEARLY_PRODUCT_ID?.trim() },
  };
}

export function billingAvailability(env: BillingEnv) {
  const sub = billingProducts(env, "subscription");
  const one = billingProducts(env, "onetime");
  const enabled = Boolean(env.CREEM_API_KEY?.trim());
  return {
    pro: {
      month: enabled && Boolean(sub.pro.month || one.pro.month),
      year: enabled && Boolean(sub.pro.year || one.pro.year),
    },
    max: {
      month: enabled && Boolean(sub.max.month || one.max.month),
      year: enabled && Boolean(sub.max.year || one.max.year),
    },
  };
}

export function isBillingConfigured(env: BillingEnv): boolean {
  return Object.values(billingAvailability(env)).some(({ month, year }) => month || year);
}

export async function handleBillingCheckoutRequest(request: Request, env: BillingEnv): Promise<Response> {
  if (request.method !== "POST") return jsonResponse(405, { error: "Method not allowed." });

  const user = await getSessionUser(request, env);
  if (!user) {
    return jsonResponse(401, { error: "Please sign in with your email before upgrading." });
  }

  let body: { tier?: unknown; interval?: unknown; mode?: unknown } = {};
  try {
    body = (await request.json()) as { tier?: unknown; interval?: unknown; mode?: unknown };
  } catch {
    // default to pro monthly
  }
  const tier: "pro" | "max" = body.tier === "max" ? "max" : "pro";
  const interval: "month" | "year" = body.interval === "year" ? "year" : "month";
  const mode: "subscription" | "onetime" = body.mode === "onetime" ? "onetime" : "subscription";

  const apiKey = env.CREEM_API_KEY?.trim();
  const productId = billingProducts(env, mode)[tier][interval];

  if (!apiKey || !productId) {
    return jsonResponse(503, { error: "Selected billing plan is not configured on this server yet." });
  }

  const origin = new URL(request.url).origin;
  const baseUrl = getCreemBaseUrl(env);
  const metadata: Record<string, unknown> = { email: user.email, plan: tier, interval, mode };
  if (mode === "onetime") {
    metadata.days = interval === "year" ? 365 : 30;
  }

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
        success_url: `${origin}/create?upgraded=${tier}`,
        customer: { email: user.email },
        metadata,
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
  const evtKey = eventId ? `webhook_evt:${eventId}` : "";
  if (evtKey) {
    const seen = env.PROFILES_KV ? await env.PROFILES_KV.get(evtKey) : memEvents.has(evtKey) ? "1" : null;
    if (seen) {
      return jsonResponse(200, { ok: true, duplicate: true });
    }
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

  const grantedTier: PlanTier = obj?.metadata?.plan === "max" ? "max" : "pro";

  if (GRANT_EVENTS.has(eventType)) {
    const prev = await getUserPlan(email, env);
    const metaMode = obj?.metadata?.mode;
    const metaDays = Number(obj?.metadata?.days);
    let expiresAt = periodEnd;
    if (!expiresAt && (metaMode === "onetime" || (Number.isFinite(metaDays) && metaDays > 0))) {
      const days =
        Number.isFinite(metaDays) && metaDays > 0
          ? Math.min(3650, Math.floor(metaDays))
          : obj?.metadata?.interval === "year"
            ? 365
            : 30;
      const prevExpiry =
        prev.record?.plan === grantedTier && prev.record.expiresAt && Number.isFinite(Date.parse(prev.record.expiresAt))
          ? Date.parse(prev.record.expiresAt)
          : 0;
      const baseMs = Math.max(Date.now(), prevExpiry);
      expiresAt = new Date(baseMs + days * 86_400_000).toISOString();
    }
    await setUserPlan(
      email,
      {
        plan: grantedTier,
        status: "active",
        customerId: customerId || prev.record?.customerId,
        subscriptionId: subscriptionId || prev.record?.subscriptionId,
        updatedAt: new Date().toISOString(),
        ...(expiresAt ? { expiresAt } : {}),
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

  if (evtKey) {
    if (env.PROFILES_KV) await env.PROFILES_KV.put(evtKey, new Date().toISOString());
    else memEvents.add(evtKey);
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

  let body: { count?: unknown; days?: unknown; maxUses?: unknown; code?: unknown; note?: unknown; plan?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body." });
  }

  const plan: PlanTier = body.plan === "max" ? "max" : "pro";
  const days = Math.min(3650, Math.max(1, Math.floor(Number(body.days) || 30)));
  const maxUses = Math.min(1000, Math.max(1, Math.floor(Number(body.maxUses) || 1)));
  const count = Math.min(50, Math.max(1, Math.floor(Number(body.count) || 1)));
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 120) : undefined;
  const customCode = normalizeRedeemCode(body.code);

  const created: RedeemCodeRecord[] = [];
  if (customCode) {
    const rec: RedeemCodeRecord = {
      code: customCode,
      plan,
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
        plan,
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
    codes: created.map((c) => ({ code: c.code, plan: c.plan ?? "pro", days: c.days, maxUses: c.maxUses })),
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

  const grantedTier: PlanTier = record.plan === "max" ? "max" : "pro";
  const prev = await getUserPlan(email, env);
  const prevExpMs = prev.record?.expiresAt ? Date.parse(prev.record.expiresAt) : 0;
  const baseMs = prev.isPro && Number.isFinite(prevExpMs) && prevExpMs > Date.now() ? prevExpMs : Date.now();
  const nextExpiresAt = new Date(baseMs + record.days * 86400_000).toISOString();
  const effectiveTier: PlanTier = prev.isMax || grantedTier === "max" ? "max" : "pro";

  record.usedBy.push(email);
  await saveRedeemCode(record, env);
  await setUserPlan(
    email,
    {
      plan: effectiveTier,
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
    plan: effectiveTier,
    isPro: true,
    isMax: effectiveTier === "max",
    credits: await getCredits(email, env, request),
    dailyLimit: Math.floor(PLAN_CREDITS[effectiveTier] / CREDIT_COST.generate),
    maxSites: PLAN_LIMITS[effectiveTier].maxSites,
    quotaPeriod: "month",
    editDailyLimit: Math.floor(PLAN_CREDITS[effectiveTier] / CREDIT_COST.edit),
    days: record.days,
    expiresAt: nextExpiresAt,
  });
}
