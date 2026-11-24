import { CREDIT_COST, REFERRAL_CREDITS } from "../lib/credits";
import { withSiteWrite, type PublishEnv } from "./publish";

export const MAX_REFERRAL_REWARDS = 6;
export const INVITER_TRIAL_DAYS = 7;
export const INVITEE_TRIAL_DAYS = 3;

const MAX_QUALIFICATIONS_PER_IP_DAY = 2;

const DISPOSABLE_DOMAINS = new Set([
  "tempmail.com",
  "temp-mail.org",
  "10minutemail.com",
  "guerrillamail.com",
  "mailinator.com",
  "yopmail.com",
  "sharklasers.com",
  "trashmail.com",
  "getnada.com",
  "dispostable.com",
  "maildrop.cc",
  "mohmal.com",
]);

export interface ReferralRecord {
  code: string;
  referredBy?: string;
  qualifiedAt?: string;
  inviterCreditPending?: boolean;
  creditedInvitees?: string[];
  invitedCount: number;
  awardedCredits?: number;
  bonusGenerates?: number; // Remaining allowances on pre-credits accounts
  bonusEdits?: number;
  trialExpiresAt?: string;
}

const memRefRecords = new Map<string, string>();
const memRefOwners = new Map<string, string>();
const memIpCaps = new Map<string, number>();

function cleanEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizeRefCode(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
}

function isDisposableEmail(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase() || "";
  return DISPOSABLE_DOMAINS.has(domain);
}

function randomRefCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

async function kvGet(key: string, map: Map<string, string>, env: PublishEnv): Promise<string | null> {
  return env.PROFILES_KV ? env.PROFILES_KV.get(key) : (map.get(key) ?? null);
}

async function kvPut(key: string, value: string, map: Map<string, string>, env: PublishEnv): Promise<void> {
  if (env.PROFILES_KV) await env.PROFILES_KV.put(key, value);
  else map.set(key, value);
}

export async function getOrCreateReferralRecord(email: string, env: PublishEnv): Promise<ReferralRecord> {
  const norm = cleanEmail(email);
  const key = `ref_user:${norm}`;
  const raw = await kvGet(key, memRefRecords, env);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as ReferralRecord;
      if (parsed.code) return parsed;
    } catch {
      // recreate below
    }
  }

  let code = randomRefCode();
  for (let i = 0; i < 5; i++) {
    const existingOwner = await kvGet(`ref_owner:${code}`, memRefOwners, env);
    if (!existingOwner || existingOwner === norm) break;
    code = randomRefCode();
  }

  const record: ReferralRecord = {
    code,
    invitedCount: 0,
    awardedCredits: 0,
  };
  await kvPut(key, JSON.stringify(record), memRefRecords, env);
  await kvPut(`ref_owner:${code}`, norm, memRefOwners, env);
  return record;
}

export async function readReferralRecord(email: string | undefined, env: PublishEnv): Promise<ReferralRecord | null> {
  if (!email) return null;
  const raw = await kvGet(`ref_user:${cleanEmail(email)}`, memRefRecords, env);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ReferralRecord;
  } catch {
    return null;
  }
}

async function saveReferralRecord(email: string, record: ReferralRecord, env: PublishEnv): Promise<void> {
  await kvPut(`ref_user:${cleanEmail(email)}`, JSON.stringify(record), memRefRecords, env);
}

export function isTrialActive(record: ReferralRecord | null): boolean {
  if (!record?.trialExpiresAt) return false;
  const ts = Date.parse(record.trialExpiresAt);
  return Number.isFinite(ts) && ts > Date.now();
}

export function referralCreditGrant(record?: ReferralRecord | null): number {
  return record?.awardedCredits ?? (record?.bonusGenerates ?? 0) * CREDIT_COST.generate + (record?.bonusEdits ?? 0) * CREDIT_COST.edit;
}

/**
 * Bind an inviter to a newly signed-in user (one-time only, no self-referral, no disposable email,
 * and never for existing users who already have a referral record, sites, usage, or a paid plan).
 */
export async function bindReferralOnLogin(
  inviteeEmail: string,
  rawRefCode: unknown,
  env: PublishEnv,
  options?: { isExistingUser?: boolean },
): Promise<ReferralRecord> {
  const invitee = cleanEmail(inviteeEmail);
  return withSiteWrite("", invitee, env, async (lockedEnv) => {
    const existedBefore = Boolean(await readReferralRecord(invitee, lockedEnv));
    const record = await getOrCreateReferralRecord(invitee, lockedEnv);
    if (existedBefore || record.referredBy || record.qualifiedAt || options?.isExistingUser) return record;

    const code = normalizeRefCode(rawRefCode);
    if (!code || code === record.code || isDisposableEmail(invitee)) return record;

    const inviterEmail = await kvGet(`ref_owner:${code}`, memRefOwners, lockedEnv);
    if (!inviterEmail || cleanEmail(inviterEmail) === invitee) return record;

    record.referredBy = cleanEmail(inviterEmail);
    await saveReferralRecord(invitee, record, lockedEnv);
    return record;
  });
}

function extendTrialIso(currentIso: string | undefined, days: number): string {
  const curTs = currentIso ? Date.parse(currentIso) : 0;
  const base = Number.isFinite(curTs) && curTs > Date.now() ? curTs : Date.now();
  return new Date(base + days * 86400_000).toISOString();
}

async function consumeIpReferralCap(ip: string, env: PublishEnv): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10);
  const key = `ref_ip:${ip}:${day}`;
  let count = 0;
  if (env.PROFILES_KV) {
    const raw = await env.PROFILES_KV.get(key);
    count = Number(raw ?? "0") || 0;
  } else {
    count = memIpCaps.get(key) ?? 0;
  }
  if (count >= MAX_QUALIFICATIONS_PER_IP_DAY) return false;
  const next = count + 1;
  if (env.PROFILES_KV) await env.PROFILES_KV.put(key, String(next));
  else memIpCaps.set(key, next);
  return true;
}

async function creditInviterIdempotent(inviter: string, invitee: string, env: PublishEnv): Promise<boolean> {
  return withSiteWrite("", inviter, env, async (lockedEnv) => {
    const inviterRec = await getOrCreateReferralRecord(inviter, lockedEnv);
    const credited = inviterRec.creditedInvitees ?? [];
    if (credited.includes(invitee)) return true;
    if (inviterRec.invitedCount >= MAX_REFERRAL_REWARDS) return false;
    inviterRec.creditedInvitees = [...credited, invitee];
    inviterRec.invitedCount += 1;
    inviterRec.awardedCredits = referralCreditGrant(inviterRec) + REFERRAL_CREDITS.inviter;
    inviterRec.trialExpiresAt = extendTrialIso(inviterRec.trialExpiresAt, INVITER_TRIAL_DAYS);
    await saveReferralRecord(inviter, inviterRec, lockedEnv);
    return true;
  });
}

/**
 * Trigger mutual referral rewards the FIRST time a genuinely new referred user publishes their first site.
 * Uses per-email advisory locks + idempotent inviterCreditPending retry so interrupted publishes
 * can safely complete inviter rewards without double-crediting.
 */
export async function qualifyReferralOnPublish(
  inviteeEmail: string,
  ip: string,
  env: PublishEnv,
  isFirstSite = true,
): Promise<{
  rewarded: boolean;
  inviterRewarded?: boolean;
  inviteeBonus?: { credits: number; trialDays: number; inviterRewarded: boolean };
}> {
  const invitee = cleanEmail(inviteeEmail);
  const step = await withSiteWrite("", invitee, env, async (lockedEnv) => {
    const record = await readReferralRecord(invitee, lockedEnv);
    if (!record?.referredBy) return null;

    const inviterEmail = cleanEmail(record.referredBy);
    if (inviterEmail === invitee) return null;

    // Retry path: invitee was already qualified, but inviter credit was interrupted earlier
    if (record.qualifiedAt) {
      if (record.inviterCreditPending) {
        return { inviterEmail, isRetry: true };
      }
      return null;
    }

    if (!isFirstSite) return null;

    const withinIpCap = await consumeIpReferralCap(ip || "unknown", lockedEnv);
    if (!withinIpCap) return null;

    record.qualifiedAt = new Date().toISOString();
    record.inviterCreditPending = true;
    record.awardedCredits = referralCreditGrant(record) + REFERRAL_CREDITS.invitee;
    record.trialExpiresAt = extendTrialIso(record.trialExpiresAt, INVITEE_TRIAL_DAYS);
    await saveReferralRecord(invitee, record, lockedEnv);
    return { inviterEmail, isRetry: false };
  });

  if (!step) return { rewarded: false };

  const inviterRewarded = await creditInviterIdempotent(step.inviterEmail, invitee, env);

  await withSiteWrite("", invitee, env, async (lockedEnv) => {
    const latest = await readReferralRecord(invitee, lockedEnv);
    if (latest?.inviterCreditPending) {
      latest.inviterCreditPending = false;
      await saveReferralRecord(invitee, latest, lockedEnv);
    }
  });

  if (step.isRetry) return { rewarded: false, inviterRewarded };

  return {
    rewarded: true,
    inviterRewarded,
    inviteeBonus: {
      credits: REFERRAL_CREDITS.invitee,
      trialDays: INVITEE_TRIAL_DAYS,
      inviterRewarded,
    },
  };
}
