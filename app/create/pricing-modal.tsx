"use client";

import { Check, KeyRound, Sparkles, Tag, X } from "lucide-react";
import { useEffect, useState } from "react";
import { PLAN_CREDITS, creationPricing } from "../../lib/credits";
import type { PlanTier } from "../../lib/models";
import type { Lang } from "../../lib/schema";

interface PricingModalProps {
  open: boolean;
  onClose: () => void;
  lang: Lang;
  currentPlan: PlanTier;
  isTrial?: boolean;
  busyTier: "pro" | "max" | null;
  error?: string | null;
  onSelectPlan: (tier: "pro" | "max", interval: "month" | "year", discountCode?: string) => void;
  onOpenRedeem: () => void;
}

type PlansProps = Pick<PricingModalProps, "lang" | "currentPlan" | "isTrial" | "busyTier" | "error" | "onSelectPlan">;

export async function requestCheckout(
  tier: "pro" | "max",
  interval: "month" | "year",
  mode: "subscription" | "onetime" = "subscription",
  discountCode?: string,
) {
  const cleanCode = discountCode?.trim().toUpperCase() || undefined;
  const response = await fetch("/api/billing/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tier, interval, mode, ...(cleanCode ? { discountCode: cleanCode } : {}) }),
    signal: AbortSignal.timeout(12000),
  });
  if (response.status === 401) return null;
  const data = await response.json();
  if (!response.ok || !data.checkoutUrl) throw new Error(data.error || "Could not start checkout.");
  return data.checkoutUrl as string;
}

export function PricingPlans({ lang, currentPlan, isTrial = false, busyTier, error, onSelectPlan }: PlansProps) {
  const [interval, setInterval] = useState<"month" | "year">("month");
  const [discountCode, setDiscountCode] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const preset = params.get("coupon") || params.get("discount");
    if (preset) setDiscountCode(preset.trim().toUpperCase());
  }, []);

  const [available, setAvailable] = useState<Record<"pro" | "max", Record<"month" | "year", boolean>> | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/billing/plans", { signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then(setAvailable)
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const isZh = lang === "zh";

  const tiers = [
    {
      id: "free" as const,
      name: "Free",
      tagline: isZh ? "个人尝鲜与基础简历站" : "For getting started",
      priceMonth: "$0",
      priceYear: "$0",
      popular: false,
      features: isZh
        ? [
            "DeepSeek Chat / GPT-4o mini 免费托管",
            `每账号一次性 ${PLAN_CREDITS.free} 点（终身体验）`,
            "点击编辑简历，可上传照片或选择 4 款预设头像",
            "最多 2 个托管个人站（30 天有效）",
            "访客托管对话 30 次/天（自带 Key 无限）",
          ]
        : [
            "DeepSeek Chat & GPT-4o mini hosted",
            `${PLAN_CREDITS.free} one-time lifetime credits per account`,
            "Inline editing, photo upload and 4 preset avatars",
            "Up to 2 hosted sites (30-day validity)",
            "30 hosted visitor chats/day (BYOK unlimited)",
          ],
    },
    {
      id: "pro" as const,
      name: "Pro",
      tagline: isZh ? "求职季主力 · 解锁 AI 实时精修" : "Best for active job seekers",
      priceMonth: "$20",
      priceYear: "$190",
      popular: true,
      features: isZh
        ? [
            "解锁 DeepSeek V4.1 Flash / R1 / GPT-4o / o3-mini",
            `每个自然月 ${PLAN_CREDITS.pro} 点`,
            "专属「AI 多轮实时精修 + 版本回退」",
            "最多 10 个个人站 · 有效期内永不过期",
            "访客托管 AI 对话 200 次/天",
          ]
        : [
            "Unlock DeepSeek V4.1 Flash, R1, GPT-4o, o3-mini",
            `${PLAN_CREDITS.pro} credits per calendar month`,
            "Multi-turn AI Live Refine + rollback",
            "Up to 10 sites · never expires while subscribed",
            "200 hosted visitor AI chats / day",
          ],
    },
    {
      id: "max" as const,
      name: "Max",
      tagline: isZh ? "旗舰模型全开 · 支持工作室白标接单商用" : "Flagship models & agency white-label",
      priceMonth: "$49",
      priceYear: "$469",
      popular: false,
      features: isZh
        ? [
            "解锁全部旗舰模型（GPT-6.2 Sol / 6.1 / 5.4）",
            `每个自然月 ${PLAN_CREDITS.max.toLocaleString("en-US")} 点`,
            "AI 多轮实时精修与版本回退",
            "白标商用：支持隐藏底部 TalkCV 水印",
            "最多 30 个客户个人站 · 有效期内永不过期",
            "访客托管 AI 对话 600 次/天 + 优先路由",
          ]
        : [
            "Unlock all flagship models (GPT-6.2 Sol, 6.1, 5.4)",
            `${PLAN_CREDITS.max.toLocaleString("en-US")} credits per calendar month`,
            "Multi-turn AI Live Refine and rollback",
            "Agency White-label: hide TalkCV footer watermark",
            "Up to 30 client sites · never expires while subscribed",
            "600 hosted visitor AI chats/day + priority routing",
          ],
    },
  ];

  return (
    <>
      <div className="af-pricing-toggle" role="group" aria-label={isZh ? "账单周期" : "Billing interval"}>
        <button
          type="button"
          aria-pressed={interval === "month"}
          className={interval === "month" ? "active" : ""}
          onClick={() => setInterval("month")}
        >
          {isZh ? "30 天单次买" : "Monthly"}
        </button>
        <button
          type="button"
          aria-pressed={interval === "year"}
          className={interval === "year" ? "active" : ""}
          onClick={() => setInterval("year")}
        >
          {isZh ? "365 天年付" : "Yearly"}
        </button>
      </div>

      <p className="af-quota-note">
        {creationPricing(lang)}
        {isZh ? " 中文页支持支付宝单次购买（账单地区选 China），不自动续费。" : ""}
      </p>
      <div style={{ display: "flex", justifyContent: "center", margin: "10px 0 18px" }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            padding: "8px 14px",
            borderRadius: 12,
            background: "rgba(15, 118, 110, 0.06)",
            border: "1.5px solid rgba(15, 118, 110, 0.25)",
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13,
              fontWeight: 600,
              color: "#0f766e",
            }}
          >
            <Tag size={14} />
            {isZh ? "有打折券？" : "Have a discount code?"}
          </span>
          <input
            type="text"
            value={discountCode}
            onChange={(e) => setDiscountCode(e.target.value.toUpperCase())}
            placeholder={isZh ? "输入券码，如 OFF20-XXXX" : "e.g. OFF20-XXXX"}
            style={{
              width: 210,
              padding: "7px 12px",
              borderRadius: 8,
              border: "1.5px solid rgba(15, 23, 42, 0.18)",
              background: "#ffffff",
              color: "#0f172a",
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: "0.02em",
              fontFamily: "var(--font-mono, ui-monospace, monospace)",
              outline: "none",
            }}
          />
          {discountCode.trim() && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 12,
                fontWeight: 600,
                color: "#0f766e",
              }}
            >
              <Check size={13} />
              {isZh ? "结账时自动减免" : "Applied at checkout"}
              <button
                type="button"
                aria-label={isZh ? "清除券码" : "Clear code"}
                onClick={() => setDiscountCode("")}
                style={{
                  border: "none",
                  background: "transparent",
                  color: "#64748b",
                  cursor: "pointer",
                  padding: 2,
                  display: "inline-flex",
                }}
              >
                <X size={13} />
              </button>
            </span>
          )}
        </div>
      </div>
      <div className="af-pricing-grid">
        {tiers.map((t) => {
          const isCurrent = !isTrial && currentPlan === t.id;
          const unavailable = t.id !== "free" && !available?.[t.id][interval];
          let action =
            isTrial && t.id === "pro"
              ? isZh
                ? "升级正式 Pro →"
                : "Upgrade to Paid Pro →"
              : isZh
                ? `立即升级 ${t.name} →`
                : `Upgrade to ${t.name} →`;
          if (isCurrent) action = isZh ? "当前方案" : "Current plan";
          else if (unavailable && interval === "year") action = isZh ? "暂未开放年付" : "Yearly billing unavailable";
          else if (unavailable) action = isZh ? "暂未开放月付" : "Monthly billing unavailable";
          else if (busyTier === t.id) action = isZh ? "正在跳转收银台…" : "Opening checkout…";
          const price = interval === "year" ? t.priceYear : t.priceMonth;
          const unit = t.id === "free" ? "" : interval === "year" ? (isZh ? "/365天" : "/yr") : isZh ? "/30天" : "/mo";
          return (
            <div key={t.id} className={`af-pricing-card${t.popular ? " is-popular" : ""}`}>
              {t.popular && (
                <span className="af-pricing-badge">
                  <Sparkles size={11} /> {isZh ? "最受欢迎" : "Most Popular"}
                </span>
              )}
              <h3>{t.name}</h3>
              <p className="af-pricing-tagline">{t.tagline}</p>
              <div className="af-pricing-price">
                <strong>{price}</strong>
                {unit && <span>{unit}</span>}
              </div>
              <ul className="af-pricing-features">
                {t.features.map((f) => (
                  <li key={f}>
                    <Check size={14} />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              {t.id === "free" ? (
                <button type="button" className="af-btn af-btn-secondary af-pricing-cta" disabled>
                  {isCurrent ? (isZh ? "当前方案" : "Current Plan") : isZh ? "基础免费版" : "Free Tier"}
                </button>
              ) : (
                <button
                  type="button"
                  className={`af-btn ${t.popular ? "af-btn-primary" : "af-btn-secondary"} af-pricing-cta`}
                  disabled={busyTier !== null || isCurrent || unavailable}
                  onClick={() => onSelectPlan(t.id, interval, discountCode.trim() || undefined)}
                >
                  {action}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {error && <div className="af-ai-error">{error}</div>}

    </>
  );
}

export function PricingModal({ open, onClose, onOpenRedeem, ...plans }: PricingModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  const isZh = plans.lang === "zh";
  return (
    <div className="af-cmd-backdrop" role="dialog" aria-modal="true" aria-label="Pricing plans" onClick={onClose}>
      <div className="af-pricing-modal" onClick={(e) => e.stopPropagation()}>
        <div className="af-pricing-head">
          <div>
            <p className="af-eyebrow">TALKCV PLANS</p>
            <h2>{isZh ? "选择适合你的 TalkCV 会员方案" : "Upgrade your TalkCV plan"}</h2>
          </div>
          <button type="button" className="af-icon-pill" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </div>

        <PricingPlans {...plans} />
        <div className="af-pricing-footer">
          <span>
            {isZh
              ? "订阅可随时在账单门户取消续订。"
              : "Manage or cancel renewal in the billing portal at any time."}
          </span>
          <button
            type="button"
            className="af-inline-link"
            onClick={() => {
              onClose();
              onOpenRedeem();
            }}
          >
            <KeyRound size={12} style={{ display: "inline", marginRight: 4 }} />
            {isZh ? "已有内测/活动兑换码？点此兑换" : "Have an invite code? Redeem here"}
          </button>
        </div>
      </div>
    </div>
  );
}
