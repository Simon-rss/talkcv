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

const memPlans = new Map<string, string>();
const memEvents = new Set<string>();

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
