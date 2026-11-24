import { CREDIT_COST, PLAN_CREDITS, type CreditBalance } from "../lib/credits";
import type { PlanTier } from "../lib/models";
import { getCookieUsage, getDailyUsage, legacyUsageCount, type AuthEnv } from "./auth";
import { getUserPlan } from "./billing";
import { withSiteWrite } from "./publish";

interface Pool { used: number; legacyGenerations: number }
interface Hold { period: string; base: number; bonus: number; expires: number }
export interface CreditLedger { pools: Record<string, Pool>; bonusUsed: number; settledCredits: number; holds: Record<string, Hold> }
interface Receipt { id: string; expires: number }
const memory = new Map<string, string>();
const timeoutMs = 120_000;

function undo(ledger: CreditLedger, hold: Hold) {
  ledger.pools[hold.period].used -= hold.base;
  ledger.bonusUsed -= hold.bonus;
}

export function releaseExpiredCredits(ledger: CreditLedger) {
  let changed = false;
  for (const [id, hold] of Object.entries(ledger.holds)) {
    if (hold.expires > Date.now()) continue;
    undo(ledger, hold);
    delete ledger.holds[id];
    changed = true;
  }
  return changed;
}

export function creditPeriod(tier: PlanTier) {
  return tier === "free" ? "lifetime" : new Date(Date.now()).toISOString().slice(0, 7);
}

export function creditBalance(tier: PlanTier, granted: number, used: number, bonusUsed: number): CreditBalance {
  const bonusRemaining = Math.max(0, granted - bonusUsed);
  return { remaining: Math.max(0, PLAN_CREDITS[tier] - used) + bonusRemaining,
    total: PLAN_CREDITS[tier] + granted, period: tier === "free" ? "lifetime" : "month", bonusRemaining };
}

export async function listCreditRows(prefix: string, env: AuthEnv): Promise<{ key: string; value: string; updatedAt?: string }[]> {
  const store = env.PROFILES_KV;
  if (!store) return [...memory].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, value }));
  if (store.listPrefix) return store.listPrefix(prefix, 50000);
  const rows: { key: string; value: string }[] = [];
  let cursor: string | undefined;
  if (store.list) do {
    const page = await store.list({ prefix, cursor });
    for (const { name } of page.keys) {
      const value = await store.get(name);
      if (value !== null) rows.push({ key: name, value });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return rows;
}

// Early releases stored one generation counter per day, before lifetime and monthly counters existed.
async function legacyDailyGenerations(email: string, period: string, env: AuthEnv) {
  if (!env.PROFILES_KV) return 0;
  const prefix = `usage:${email}:`;
  const rows = await listCreditRows(prefix + (period === "lifetime" ? "" : period + "-"), env);
  return rows.reduce((sum, row) => /^\d{4}-\d{2}-\d{2}$/.test(row.key.slice(prefix.length))
    ? sum + legacyUsageCount(row.value) : sum, 0);
}

async function save(email: string, ledger: CreditLedger, env: AuthEnv) {
  const value = JSON.stringify(ledger);
  if (env.PROFILES_KV) await env.PROFILES_KV.put(`credits:${email}`, value);
  else memory.set(`credits:${email}`, value);
}

// Called only inside the account lock. Each base pool imports its old counters once.
async function account(email: string, env: AuthEnv, request?: Request) {
  const [plan, raw] = await Promise.all([getUserPlan(email, env),
    env.PROFILES_KV ? env.PROFILES_KV.get(`credits:${email}`) : memory.get(`credits:${email}`)]);
  const tier = plan.isTrial ? "free" : plan.plan;
  const period = creditPeriod(tier);
  const ledger: CreditLedger = raw ? JSON.parse(raw) : { pools: {}, bonusUsed: 0, settledCredits: 0, holds: {} };
  let changed = releaseExpiredCredits(ledger);
  let pool = ledger.pools[period];
  const unit = tier === "free" ? "lifetime" : "month";
  if (!pool) {
    const [generations, daily, edits] = await Promise.all([
      getDailyUsage(email, env, request, unit), legacyDailyGenerations(email, period, env),
      tier !== "free" && env.PROFILES_KV ? env.PROFILES_KV.get(`edit_usage_month:${email}:${period}`) : null,
    ]);
    pool = { legacyGenerations: generations, used: (generations + daily) * CREDIT_COST.generate +
      legacyUsageCount(edits) * CREDIT_COST.edit };
    ledger.pools[period] = pool;
    changed = true;
  } else if (request) {
    const previous = await getCookieUsage(request, email, unit, env);
    if (previous > pool.legacyGenerations) {
      pool.used += (previous - pool.legacyGenerations) * CREDIT_COST.generate;
      pool.legacyGenerations = previous;
      changed = true;
    }
  }
  return { ledger, pool, period, changed, plan,
    balance: () => creditBalance(tier, plan.rewardCredits, pool.used, ledger.bonusUsed) };
}

export function getCreditAccount(email: string, env: AuthEnv, request?: Request) {
  return withSiteWrite("", email, env, async (locked) => {
    const state = await account(email, locked, request);
    if (state.changed) await save(email, state.ledger, locked);
    return { plan: state.plan, credits: state.balance() };
  });
}

export async function getCredits(email: string, env: AuthEnv, request?: Request) {
  return (await getCreditAccount(email, env, request)).credits;
}

export function reserveCredits(email: string, cost: number, env: AuthEnv, request?: Request) {
  return withSiteWrite("", email, env, async (locked): Promise<Response | Receipt> => {
    const state = await account(email, locked, request);
    const credits = state.balance();
    if (credits.remaining < cost) {
      if (state.changed) await save(email, state.ledger, locked);
      return Response.json({ error: `需要 ${cost} 点，剩余 ${credits.remaining} 点。 / ${cost} credits required, ${credits.remaining} remaining.`,
        required: cost, remaining: credits.remaining, credits }, { status: 429, headers: { "cache-control": "no-store" } });
    }
    const base = Math.min(cost, credits.remaining - credits.bonusRemaining);
    const bonus = cost - base;
    const receipt = { id: crypto.randomUUID(), expires: Date.now() + timeoutMs };
    state.pool.used += base;
    state.ledger.bonusUsed += bonus;
    state.ledger.holds[receipt.id] = { period: state.period, base, bonus, expires: receipt.expires };
    await save(email, state.ledger, locked);
    return receipt;
  });
}

function settle(email: string, receipt: Receipt, env: AuthEnv, refund: boolean) {
  return withSiteWrite("", email, env, async (locked) => {
    const state = await account(email, locked);
    const hold = state.ledger.holds[receipt.id];
    if (hold) {
      if (refund) undo(state.ledger, hold);
      else state.ledger.settledCredits += hold.base + hold.bonus;
      delete state.ledger.holds[receipt.id];
    }
    if (hold || state.changed) await save(email, state.ledger, locked);
    return { credits: state.balance(), settled: Boolean(hold) };
  });
}

export function refundCredits(email: string, receipt: Receipt, env: AuthEnv) {
  return settle(email, receipt, env, true);
}

export async function withCreationCredits(email: string | undefined, cost: number, env: AuthEnv, request: Request,
  create: (signal: AbortSignal) => Promise<Response | Record<string, unknown>>) {
  if (cost && !email) return Response.json({ error: "Sign in to use hosted credits." }, { status: 401 });
  const receipt = email && cost ? await reserveCredits(email, cost, env, request) : null;
  if (receipt instanceof Response) return receipt;
  const signal = AbortSignal.timeout(receipt ? Math.max(1, receipt.expires - Date.now()) : timeoutMs);
  let result: Response | Record<string, unknown>;
  try {
    result = await create(signal);
    signal.throwIfAborted();
  } catch (err) {
    const timedOut = signal.aborted || (err instanceof Error && err.name === "TimeoutError");
    result = Response.json({ error: timedOut ? "AI provider timed out." : "Invalid or unavailable AI provider response." },
      { status: timedOut ? 504 : 502 });
  }
  if (result instanceof Response) {
    if (email && receipt) {
      const { credits } = await refundCredits(email, receipt, env);
      return Response.json({ ...await result.json(), credits }, { status: result.status, headers: { "cache-control": "no-store" } });
    }
    return result;
  }
  let credits: CreditBalance | null = null;
  if (email && receipt) {
    const final = await settle(email, receipt, env, false);
    if (!final.settled) return Response.json({ error: "AI provider timed out.", credits: final.credits }, { status: 504 });
    credits = final.credits;
  } else if (email) credits = await getCredits(email, env, request);
  return Response.json({ ...result, credits }, { headers: { "cache-control": "private, no-store" } });
}
