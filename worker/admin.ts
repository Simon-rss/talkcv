import { CREDIT_COST } from "../lib/credits";
import { creditBalance, creditPeriod, listCreditRows, releaseExpiredCredits, type CreditLedger } from "./credits";
import { getSessionUser, legacyUsageCount, type AuthEnv } from "./auth";
import { getUserPlan, handleCreateRedeemCodesRequest, type BillingEnv, type PlanRecord, type RedeemCodeRecord } from "./billing";
import type { StoredProfileRecord } from "./publish";
import { countLeads } from "./leads";
import { isTrialActive, readReferralRecord, referralCreditGrant, type ReferralRecord } from "./referral";

export interface AdminEnv extends AuthEnv, BillingEnv {
  ADMIN_EMAILS?: string;
  ADMIN_ALLOW_DEV_AUTH?: string;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export function isAdminEmail(email: string, env: AdminEnv): boolean {
  const raw = env.ADMIN_EMAILS?.trim();
  if (!raw) return false;
  const allowed = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.trim().toLowerCase());
}

async function requireAdmin(
  request: Request,
  env: AdminEnv,
): Promise<{ ok: true; email: string } | { ok: false; response: Response }> {
  if (!env.RESEND_API_KEY?.trim() && env.ADMIN_ALLOW_DEV_AUTH !== "1") {
    return {
      ok: false,
      response: jsonResponse(503, { error: "Admin access requires verified email delivery (RESEND_API_KEY)." }),
    };
  }
  const user = await getSessionUser(request, env);
  if (!user) {
    return { ok: false, response: jsonResponse(401, { error: "Please sign in first." }) };
  }
  if (!isAdminEmail(user.email, env)) {
    return { ok: false, response: jsonResponse(403, { error: "Admin access required." }) };
  }
  return { ok: true, email: user.email };
}

async function listByPrefix(
  prefix: string,
  env: AdminEnv,
  limit = 5000,
): Promise<Array<{ key: string; value: string; updatedAt?: string }>> {
  if (env.PROFILES_KV?.listPrefix) {
    return env.PROFILES_KV.listPrefix(prefix, limit);
  }
  return [];
}

function safeParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function handleAdminOverviewRequest(request: Request, env: AdminEnv): Promise<Response> {
  if (request.method !== "GET") return jsonResponse(405, { error: "Method not allowed." });
  const gate = await requireAdmin(request, env);
  if (!gate.ok) return gate.response;

  const [profileRows, userSitesRows, planRows, refRows, usageRows, editUsageRows, creditRows, insightRows, codeRows, totalLeads] =
    await Promise.all([
      listByPrefix("profile:", env, 5000),
      listByPrefix("user_sites:", env, 5000),
      listByPrefix("plan:", env, 5000),
      listByPrefix("ref_user:", env, 5000),
      listCreditRows("usage:", env),
      listCreditRows("edit_usage_month:", env),
      listCreditRows("credits:", env),
      listByPrefix("insights:", env, 5000),
      listByPrefix("redeem:", env, 1000),
      countLeads(env),
    ]);

  // Insights by slug
  const insightsBySlug = new Map<string, { views: number; questions: number }>();
  let totalViews = 0;
  let totalQuestions = 0;
  for (const row of insightRows) {
    const slug = row.key.slice("insights:".length);
    const data = safeParse<{ views?: number; questions?: number }>(row.value);
    const views = Number(data?.views ?? 0) || 0;
    const questions = Number(data?.questions ?? 0) || 0;
    insightsBySlug.set(slug, { views, questions });
    totalViews += views;
    totalQuestions += questions;
  }

  // Published sites
  const sites = profileRows
    .map((row) => {
      const slug = row.key.slice("profile:".length);
      const rec = safeParse<StoredProfileRecord>(row.value);
      if (!rec?.profile) return null;
      const stats = insightsBySlug.get(slug) ?? { views: 0, questions: 0 };
      const ownerEmail = rec.ownerEmail?.toLowerCase() ?? "";
      return {
        slug,
        name: rec.profile.basics?.name?.zh || rec.profile.basics?.name?.en || slug,
        headline: rec.profile.basics?.headline?.zh || rec.profile.basics?.headline?.en || "",
        ownerEmail,
        theme: rec.profile.theme || "editorial",
        noindex: Boolean(rec.noindex),
        protected: Boolean(rec.passcode),
        chatMode: rec.chatConfig?.mode ?? "hosted",
        hostedModel: rec.chatConfig?.hostedModelId ?? "auto",
        views: stats.views,
        questions: stats.questions,
        createdAt: rec.createdAt || row.updatedAt || "",
        expiresAt: rec.expiresAt || "",
      };
    })
    .filter((s): s is NonNullable<typeof s> => Boolean(s))
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

  // Gather all known user emails
  const emailSet = new Set<string>();
  const sitesByEmail = new Map<string, string[]>();
  const planByEmail = new Map<string, PlanRecord>();
  const refByEmail = new Map<string, ReferralRecord>();
  const legacyUsage = new Map<string, Map<string, { credits: number; generations: number }>>();
  const ledgerByEmail = new Map<string, CreditLedger>();
  const updatedByEmail = new Map<string, string>();

  const bumpUpdated = (email: string, ts?: string) => {
    if (!ts) return;
    const prev = updatedByEmail.get(email);
    if (!prev || ts > prev) updatedByEmail.set(email, ts);
  };

  for (const row of userSitesRows) {
    const email = row.key.slice("user_sites:".length).toLowerCase();
    emailSet.add(email);
    bumpUpdated(email, row.updatedAt);
    const list = safeParse<string[]>(row.value);
    if (Array.isArray(list)) sitesByEmail.set(email, list.map(String));
  }

  for (const s of sites) {
    if (s.ownerEmail) {
      emailSet.add(s.ownerEmail);
      bumpUpdated(s.ownerEmail, s.createdAt);
      const list = sitesByEmail.get(s.ownerEmail) ?? [];
      if (!list.includes(s.slug)) sitesByEmail.set(s.ownerEmail, [...list, s.slug]);
    }
  }

  for (const row of planRows) {
    const email = row.key.slice("plan:".length).toLowerCase();
    const rec = safeParse<PlanRecord>(row.value);
    if (rec) {
      emailSet.add(email);
      planByEmail.set(email, rec);
      bumpUpdated(email, rec.updatedAt || row.updatedAt);
    }
  }

  for (const row of refRows) {
    const email = row.key.slice("ref_user:".length).toLowerCase();
    const rec = safeParse<ReferralRecord>(row.value);
    if (rec) {
      emailSet.add(email);
      refByEmail.set(email, rec);
      bumpUpdated(email, row.updatedAt);
    }
  }

  for (const [prefix, rows, cost] of [
    ["usage:", usageRows, CREDIT_COST.generate], ["edit_usage_month:", editUsageRows, CREDIT_COST.edit],
  ] as const) {
    for (const row of rows) {
      const split = row.key.lastIndexOf(":");
      const email = row.key.slice(prefix.length, split).toLowerCase();
      const period = row.key.slice(split + 1);
      if (!email || !/^(?:lifetime|\d{4}-\d{2}(?:-\d{2})?)$/.test(period)) continue;
      const count = legacyUsageCount(row.value);
      const periods = legacyUsage.get(email) ?? new Map<string, { credits: number; generations: number }>();
      const usage = periods.get(period) ?? { credits: 0, generations: 0 };
      usage.credits += count * cost;
      if (prefix === "usage:") usage.generations += count;
      periods.set(period, usage);
      legacyUsage.set(email, periods);
      emailSet.add(email);
      bumpUpdated(email, row.updatedAt);
    }
  }

  for (const row of creditRows) {
    const email = row.key.slice("credits:".length);
    const ledger = JSON.parse(row.value) as CreditLedger;
    releaseExpiredCredits(ledger);
    ledgerByEmail.set(email, ledger);
    emailSet.add(email);
    if (!env.PROFILES_KV?.listPrefix) {
      const [plan, ref] = await Promise.all([getUserPlan(email, env), readReferralRecord(email, env)]);
      if (plan.record) planByEmail.set(email, plan.record);
      if (ref) refByEmail.set(email, ref);
    }
  }

  let paidUsers = 0;
  let trialUsers = 0;
  let totalReferrals = 0;

  const users = Array.from(emailSet)
    .map((email) => {
      const planRec = planByEmail.get(email);
      const refRec = refByEmail.get(email) ?? null;
      const isPaidActive = Boolean(
        planRec &&
          (planRec.plan === "pro" || planRec.plan === "max") &&
          (!planRec.expiresAt || Date.parse(planRec.expiresAt) > Date.now()),
      );
      const trialOn = !isPaidActive && isTrialActive(refRec);
      const tier = isPaidActive ? planRec!.plan : trialOn ? "pro-trial" : "free";
      if (isPaidActive) paidUsers += 1;
      if (trialOn) trialUsers += 1;
      const invitedCount = refRec?.invitedCount ?? 0;
      totalReferrals += invitedCount;

      const creditTier = isPaidActive ? planRec!.plan : "free";
      const period = creditPeriod(creditTier);
      const ledger = ledgerByEmail.get(email);
      const old = legacyUsage.get(email);
      let legacyTotal = 0;
      let legacyCurrent = 0;
      for (const [window, usage] of old ?? []) {
        legacyTotal += usage.credits;
        if (window === period || (window.length === 10 && (period === "lifetime" || window.startsWith(period + "-")))) {
          legacyCurrent += usage.credits;
        }
      }
      // Signed legacy cookies can prove generation usage beyond the last persisted counter.
      for (const [window, pool] of Object.entries(ledger?.pools ?? {})) {
        legacyTotal += Math.max(0, pool.legacyGenerations - (old?.get(window)?.generations ?? 0)) * CREDIT_COST.generate;
      }
      const baseUsed = ledger?.pools[period]?.used ?? legacyCurrent;
      const credits = creditBalance(creditTier, referralCreditGrant(refRec), baseUsed, ledger?.bonusUsed ?? 0);
      return {
        email,
        tier,
        planExpiresAt: isPaidActive ? planRec?.expiresAt ?? null : trialOn ? refRec?.trialExpiresAt ?? null : null,
        planSource: isPaidActive ? (planRec?.subscriptionId ? "creem" : "redeem") : trialOn ? "referral" : "free",
        sites: sitesByEmail.get(email) ?? [],
        credits,
        consumedCredits: legacyTotal + (ledger?.settledCredits ?? 0),
        refCode: refRec?.code ?? "",
        referredBy: refRec?.referredBy ?? null,
        invitedCount,
        lastActiveAt: updatedByEmail.get(email) ?? "",
      };
    })
    .sort((a, b) => (b.lastActiveAt || "").localeCompare(a.lastActiveAt || ""));

  const codes = codeRows
    .map((row) => safeParse<RedeemCodeRecord>(row.value))
    .filter((c): c is RedeemCodeRecord => Boolean(c?.code))
    .map((c) => ({
      code: c.code,
      plan: c.plan ?? "pro",
      days: c.days,
      maxUses: c.maxUses,
      usedCount: c.usedBy?.length ?? 0,
      usedBy: c.usedBy ?? [],
      note: c.note ?? "",
      createdAt: c.createdAt ?? "",
    }))
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

  return jsonResponse(200, {
    adminEmail: gate.email,
    summary: {
      totalUsers: users.length,
      totalSites: sites.length,
      paidUsers,
      trialUsers,
      totalReferrals,
      totalViews,
      totalQuestions,
      totalLeads,
    },
    users,
    sites,
    codes,
  });
}

export async function handleAdminCreateCodeRequest(request: Request, env: AdminEnv): Promise<Response> {
  if (request.method !== "POST") return jsonResponse(405, { error: "Method not allowed." });
  const gate = await requireAdmin(request, env);
  if (!gate.ok) return gate.response;

  const secret = env.AUTH_SECRET?.trim() || "talkcv-dev-secret-change-in-prod";
  const bodyText = await request.text();
  const internalReq = new Request(request.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${secret}`,
    },
    body: bodyText,
  });
  return handleCreateRedeemCodesRequest(internalReq, env);
}
