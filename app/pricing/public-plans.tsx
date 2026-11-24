"use client";
import { useEffect, useState } from "react";
import type { Lang } from "../../lib/schema";
import type { PlanTier } from "../../lib/models";
import { readSession } from "../../lib/login";
import { PricingPlans, requestCheckout } from "../create/pricing-modal";

export function PublicPlans({ lang }: { lang: Lang }) {
  const [currentPlan, setPlan] = useState<PlanTier>("free");
  const [isTrial, setIsTrial] = useState(false);
  const [busy, setBusy] = useState<"pro" | "max" | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    readSession(controller.signal)
      .then((user) => {
        if (controller.signal.aborted) return;
        setPlan(user?.plan ?? "free");
        setIsTrial(Boolean(user?.isTrial));
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  return <PricingPlans lang={lang} currentPlan={currentPlan} isTrial={isTrial} busyTier={busy} error={error} onSelectPlan={async (tier, interval, discountCode) => {
    setBusy(tier);
    setError("");
    try {
      const url = await requestCheckout(tier, interval, lang === "zh" ? "onetime" : "subscription", discountCode);
      window.location.assign(url ?? `/create?lang=${lang}&plan=${tier}&interval=${interval}`);
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "";
      setError(msg || (lang === "en" ? "Checkout is unavailable. Please try again later." : "暂时无法打开收银台，请稍后重试。"));
    } finally {
      setBusy(null);
    }
  }} />;
}
