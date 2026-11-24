"use client";
import { useEffect, useState } from "react";
import type { Lang } from "../../lib/schema";
import type { PlanTier } from "../../lib/models";
import { PricingPlans, requestCheckout } from "../create/pricing-modal";

export function PublicPlans({ lang }: { lang: Lang }) {
  const [currentPlan, setPlan] = useState<PlanTier>("free");
  const [isTrial, setIsTrial] = useState(false);
  const [busy, setBusy] = useState<"pro" | "max" | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then(({ user }) => {
        setPlan(user?.plan ?? "free");
        setIsTrial(Boolean(user?.isTrial));
      })
      .catch(() => {});
  }, []);
  return <PricingPlans lang={lang} currentPlan={currentPlan} isTrial={isTrial} busyTier={busy} error={error} onSelectPlan={async (tier, interval) => {
    setBusy(tier);
    setError("");
    try {
      const url = await requestCheckout(tier, interval);
      window.location.assign(url ?? `/create?lang=${lang}&plan=${tier}&interval=${interval}`);
    } catch {
      setError(lang === "en" ? "Checkout is unavailable. Please try again later." : "暂时无法打开收银台，请稍后重试。");
    } finally {
      setBusy(null);
    }
  }} />;
}
