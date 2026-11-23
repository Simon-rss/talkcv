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
  busyTier: "pro" | "max" | null;
  error?: string | null;
  onSelectPlan: (tier: "pro" | "max", interval: "month" | "year") => void;
  onOpenRedeem: () => void;
}

export function PricingModal({
  open,
  onClose,
  lang,
  currentPlan,
  busyTier,
  error,
  onSelectPlan,
  onOpenRedeem,
}: PricingModalProps) {
  const [interval, setInterval] = useState<"month" | "year">("month");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

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
            "每日 3 次 AI 简历生成",
            "预览区所见即所得手动点改",
            "最多 2 个托管个人站（30 天有效）",
            "访客托管对话 30 次/天（自带 Key 无限）",
          ]
        : [
            "DeepSeek Chat & GPT-4o mini hosted",
            "3 AI resume generations / day",
            "Free inline click-to-edit preview",
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
            "每日 15 次 AI 简历生成",
            "专属「AI 多轮实时精修 + 版本回退」（30 次/天）",
            "最多 10 个个人站 · 订阅期内永不过期",
            "访客托管 AI 对话 200 次/天",
          ]
        : [
            "Unlock DeepSeek V4.1 Flash, R1, GPT-4o, o3-mini",
            "15 AI resume generations / day",
            "Multi-turn AI Live Refine + rollback (30/day)",
            "Up to 10 sites · never expires while subscribed",
            "200 hosted visitor AI chats / day",
          ],
    },
    {
      id: "max" as const,
      name: "Max",
      tagline: isZh ? "旗舰模型全开 · 工作室与高流量首选" : "Flagship models & maximum quotas",
      priceMonth: "$49",
      priceYear: "$469",
      popular: false,
      features: isZh
        ? [
            "解锁全部旗舰模型（GPT-6.2 Sol / 6.1 / 5.4）",
            "每日 50 次 AI 简历生成",
            "专属「AI 多轮实时精修 + 版本回退」（100 次/天）",
            "最多 30 个个人站 · 订阅期内永不过期",
            "访客托管 AI 对话 600 次/天 + 优先路由",
          ]
        : [
            "Unlock all flagship models (GPT-6.2 Sol, 6.1, 5.4)",
            "50 AI resume generations / day",
            "Multi-turn AI Live Refine + rollback (100/day)",
            "Up to 30 sites · never expires while subscribed",
            "600 hosted visitor AI chats/day + priority routing",
          ],
    },
  ];

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

        <div className="af-pricing-toggle" role="group" aria-label="Billing interval">
          <button
            type="button"
            className={interval === "month" ? "active" : ""}
            onClick={() => setInterval("month")}
          >
            {isZh ? "按月订阅" : "Monthly"}
          </button>
          <button
            type="button"
            className={interval === "year" ? "active" : ""}
            onClick={() => setInterval("year")}
          >
            {isZh ? "按年订阅（省 20%）" : "Yearly (Save 20%)"}
          </button>
        </div>

        <div className="af-pricing-grid">
          {tiers.map((t) => {
            const isCurrent = currentPlan === t.id;
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
                    disabled={busyTier !== null || isCurrent}
                    onClick={() => onSelectPlan(t.id, interval)}
                  >
                    {isCurrent
                      ? isZh
                        ? "当前方案"
                        : "Current Plan"
                      : busyTier === t.id
                        ? isZh
                          ? "正在跳转收银台…"
                          : "Opening checkout…"
                        : isZh
                          ? `立即升级 ${t.name} →`
                          : `Upgrade to ${t.name} →`}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {error && <div className="af-ai-error">{error}</div>}

        <div className="af-pricing-footer">
          <span>
            {isZh
              ? "订阅期内个人站永不过期；随时可取消，退订后保留 30 天缓冲期。"
              : "Sites never expire while subscribed. Cancel anytime with a 30-day grace period."}
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
