"use client";

import { Check, KeyRound, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
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
  onSelectPlan: (tier: "pro" | "max", interval: "month" | "year") => void;
  onOpenRedeem: () => void;
}

type PlansProps = Pick<PricingModalProps, "lang" | "currentPlan" | "isTrial" | "busyTier" | "error" | "onSelectPlan">;

export async function requestCheckout(tier: "pro" | "max", interval: "month" | "year") {
  const response = await fetch("/api/billing/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tier, interval }),
    signal: AbortSignal.timeout(12000),
  });
  if (response.status === 401) return null;
  const data = await response.json();
  if (!response.ok || !data.checkoutUrl) throw new Error(data.error || "Could not start checkout.");
  return data.checkoutUrl as string;
}

export function PricingPlans({ lang, currentPlan, isTrial = false, busyTier, error, onSelectPlan }: PlansProps) {
  const [interval, setInterval] = useState<"month" | "year">("month");

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
            "每账号 3 次 AI 简历生成（终身体验）",
            "免费所见即所得点改 + 上传自定义头像",
            "最多 2 个托管个人站（30 天有效）",
            "访客托管对话 30 次/天（自带 Key 无限）",
          ]
        : [
            "DeepSeek Chat & GPT-4o mini hosted",
            "3 AI resume generations per account",
            "Free inline click-to-edit + custom avatar upload",
            "Up to 2 hosted sites (30-day validity)",
            "30 hosted visitor chats/day (BYOK unlimited)",
          ],
    },
    {
      id: "pro" as const,
      name: "Pro",
      tagline: isZh ? "求职季主力 · 解锁 AI 实时精修与头像" : "Best for active job seekers",
      priceMonth: "$20",
      priceYear: "$190",
      popular: true,
      features: isZh
        ? [
            "解锁 DeepSeek V4.1 Flash / R1 / GPT-4o / o3-mini",
            "每月 30 次 AI 简历生成",
            "专属「AI 多轮实时精修 + 版本回退」（100 次/月）",
            "专属「AI 生成职业头像」（5 次/月）",
            "最多 10 个个人站 · 订阅期内永不过期",
            "访客托管 AI 对话 200 次/天",
          ]
        : [
            "Unlock DeepSeek V4.1 Flash, R1, GPT-4o, o3-mini",
            "30 AI resume generations / month",
            "Multi-turn AI Live Refine + rollback (100/month)",
            "AI Portrait Avatar generator (5/month)",
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
            "每月 100 次 AI 简历生成 + 300 次 AI 精修/月",
            "AI 生成职业头像（20 次/月）",
            "白标商用：支持隐藏底部 TalkCV 水印",
            "最多 30 个客户个人站 · 订阅期内永不过期",
            "访客托管 AI 对话 600 次/天 + 优先路由",
          ]
        : [
            "Unlock all flagship models (GPT-6.2 Sol, 6.1, 5.4)",
            "100 generations/month + 300 AI refines/month",
            "AI Portrait Avatar generator (20/month)",
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
          {isZh ? "按月订阅" : "Monthly"}
        </button>
        <button
          type="button"
          aria-pressed={interval === "year"}
          className={interval === "year" ? "active" : ""}
          onClick={() => setInterval("year")}
        >
          {isZh ? "按年订阅" : "Yearly"}
        </button>
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
          const unit = t.id === "free" ? "" : interval === "year" ? (isZh ? "/年" : "/yr") : isZh ? "/月" : "/mo";
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
                  onClick={() => onSelectPlan(t.id, interval)}
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
