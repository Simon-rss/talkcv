"use client";

import { Megaphone, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { OPENAI_PROMO_ACTIVE } from "../lib/models";
import type { Lang } from "../lib/schema";

const PROMO_MODELS = ["GPT-6.2 Astra", "GPT-6.2 Sol", "GPT-6.1", "GPT-5.4", "GPT-4o", "o3-mini"];

export function PromoTopBanner({ lang, showCta = false }: { lang: Lang; showCta?: boolean }) {
  const [dismissed, setDismissed] = useState(false);
  if (!OPENAI_PROMO_ACTIVE || dismissed) return null;

  const isZh = lang === "zh";
  return (
    <div
      role="status"
      style={{
        background: "linear-gradient(90deg, #0f766e 0%, #0d9488 55%, #0f766e 100%)",
        color: "#ffffff",
        padding: "9px 16px",
        fontSize: 13,
        lineHeight: 1.45,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        flexWrap: "wrap",
        position: "relative",
        zIndex: 30,
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          background: "rgba(255, 255, 255, 0.18)",
          border: "1px solid rgba(255, 255, 255, 0.28)",
          padding: "2px 8px",
          borderRadius: 999,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.03em",
        }}
      >
        <Sparkles size={11} />
        {isZh ? "限时福利活动" : "LIMITED-TIME EVENT"}
      </span>
      <span style={{ fontWeight: 500 }}>
        {isZh
          ? "OpenAI 全系旗舰模型限时免费开放（新增最新旗舰 GPT-6.2 Astra，全员免费可选），活动额度用完即止！"
          : "All OpenAI flagship models — including GPT-6.2 Astra & Sol — are temporarily unlocked for every user while promo credits last!"}
      </span>
      {showCta && (
        <Link
          href={`/create?lang=${lang}`}
          style={{
            background: "#ffffff",
            color: "#0f766e",
            padding: "3px 10px",
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 700,
            textDecoration: "none",
            whiteSpace: "nowrap",
          }}
        >
          {isZh ? "立即免费体验 →" : "Try Free Now →"}
        </Link>
      )}
      <button
        type="button"
        aria-label={isZh ? "关闭横幅" : "Dismiss banner"}
        onClick={() => setDismissed(true)}
        style={{
          position: "absolute",
          right: 10,
          top: "50%",
          transform: "translateY(-50%)",
          border: "none",
          background: "transparent",
          color: "rgba(255,255,255,0.8)",
          cursor: "pointer",
          padding: 4,
          display: "inline-flex",
        }}
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function PromoAnnouncementCard({
  lang,
  onPickAstra,
  activeModelId,
}: {
  lang: Lang;
  onPickAstra?: () => void;
  activeModelId?: string;
}) {
  if (!OPENAI_PROMO_ACTIVE) return null;
  const isZh = lang === "zh";
  const alreadyAstra = activeModelId === "gpt-6.2-astra";

  return (
    <section
      aria-label={isZh ? "活动公告" : "Event Announcement"}
      style={{
        margin: "12px auto 14px",
        padding: "14px 18px",
        borderRadius: 14,
        background: "linear-gradient(135deg, rgba(15, 118, 110, 0.08) 0%, rgba(20, 184, 166, 0.04) 100%)",
        border: "1.5px solid rgba(15, 118, 110, 0.24)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 26,
              height: 26,
              borderRadius: 8,
              background: "#0f766e",
              color: "#ffffff",
            }}
          >
            <Megaphone size={14} />
          </span>
          <strong style={{ fontSize: 14, color: "#0f172a" }}>
            {isZh ? "活动公告 · OpenAI 全系模型限时免费解锁" : "Announcement · All OpenAI Models Temporarily Unlocked"}
          </strong>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#0f766e",
              background: "rgba(15, 118, 110, 0.12)",
              padding: "2px 8px",
              borderRadius: 999,
            }}
          >
            {isZh ? "进行中 · 额满即止" : "LIVE · Limited Credits"}
          </span>
        </div>

        {onPickAstra && (
          <button
            type="button"
            onClick={onPickAstra}
            disabled={alreadyAstra}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "6px 12px",
              borderRadius: 999,
              border: "none",
              background: alreadyAstra ? "rgba(15, 118, 110, 0.14)" : "#0f766e",
              color: alreadyAstra ? "#0f766e" : "#ffffff",
              fontSize: 12,
              fontWeight: 700,
              cursor: alreadyAstra ? "default" : "pointer",
              whiteSpace: "nowrap",
            }}
          >
            <Sparkles size={12} />
            {alreadyAstra
              ? isZh
                ? "已选用 GPT-6.2 Astra"
                : "Using GPT-6.2 Astra"
              : isZh
                ? "一键选用 GPT-6.2 Astra"
                : "Select GPT-6.2 Astra"}
          </button>
        )}
      </div>

      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: "#334155" }}>
        {isZh
          ? "限时福利回馈！活动期间，所有用户无需升级 Pro / Max，即可直接免费选用 OpenAI 全系旗舰模型（含最新上线的 GPT-6.2 Astra）进行简历生成、AI 精修与访客问答。免费账号自带 30 点体验额度，先到先得，活动额度用完后恢复原档位限制。"
          : "We're unlocking our entire OpenAI model lineup — including the flagship GPT-6.2 Astra — for all Free, Pro, and Max users during this limited-time event. Free accounts include 30 credits to generate and host a live résumé site using flagship OpenAI models while promo credits last."}
      </p>

      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {PROMO_MODELS.map((name) => (
          <span
            key={name}
            style={{
              fontSize: 11.5,
              fontWeight: 600,
              padding: "3px 9px",
              borderRadius: 999,
              background: name === "GPT-6.2 Astra" ? "#0f766e" : "#ffffff",
              color: name === "GPT-6.2 Astra" ? "#ffffff" : "#0f766e",
              border: "1px solid rgba(15, 118, 110, 0.25)",
            }}
          >
            {name === "GPT-6.2 Astra" ? `★ ${name}` : name}
          </span>
        ))}
      </div>
    </section>
  );
}
