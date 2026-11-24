import type { PlanTier } from "./models";

export interface AuthUser {
  email: string;
  plan?: PlanTier;
  isPro?: boolean;
  isMax?: boolean;
  isTrial?: boolean;
  hasBilling?: boolean;
  hasBillingPortal?: boolean;
  usedToday: number;
  dailyLimit: number;
  quotaPeriod?: "lifetime" | "month";
  editUsedToday?: number;
  editDailyLimit?: number;
  maxSites: number;
  sites: string[];
  referral?: {
    code: string;
    invitedCount: number;
    maxRewards: number;
    bonusGenerates: number;
    bonusEdits: number;
    trialExpiresAt?: string;
    hasPendingReferrer?: boolean;
  };
}

export function safeLoginNext(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/create";
  const base = "https://talkcv.invalid";
  try {
    const url = new URL(value, base);
    return url.origin === base && !url.pathname.startsWith("//") ? value : "/create";
  } catch { return "/create"; }
}

const referralKey = "talkcv-pending-ref";

export function captureReferral(raw: string | null) {
  const code = raw?.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12) || "";
  try {
    if (code) localStorage.setItem(referralKey, code);
    return code || localStorage.getItem(referralKey) || "";
  } catch { return code; }
}

export function clearPendingReferral() {
  try { localStorage.removeItem(referralKey); } catch { /* Storage can be unavailable in private browsing. */ }
}

export async function readSession(signal?: AbortSignal): Promise<AuthUser | null> {
  const res = await fetch("/api/auth/me", { cache: "no-store", signal });
  if (!res.ok) throw new Error("Could not read session");
  return (await res.json()).user ?? null;
}
