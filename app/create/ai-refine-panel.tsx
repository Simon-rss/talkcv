"use client";

import { History, RotateCcw, Send, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { CREDIT_COST, creditCostLabel, type CreditBalance } from "../../lib/credits";
import type { Lang, PortfolioProfile, ThemeId } from "../../lib/schema";

export interface RefineTurn {
  role: "user" | "assistant";
  content: string;
}

export interface RefineVersion {
  label: string;
  profile: PortfolioProfile;
}

interface AiRefinePanelProps {
  lang: Lang;
  profile: PortfolioProfile;
  theme: ThemeId;
  hostedModelId: string;
  providerMode: "hosted" | "byok";
  apiKey?: string;
  baseUrl?: string;
  byokModel?: string;
  onCredits: (credits: CreditBalance) => void;
  onApplyProfile: (next: PortfolioProfile) => void;
  onClose: () => void;
}

const QUICK_REFINES = {
  zh: [
    "把项目描述改得更偏资深架构师视角，突出高并发与稳定性",
    "把整体文案精简 25%，更适合外企 HR 30 秒扫读",
    "主色调换成高级深海蓝 (#0284c7)，圆角调整为 16px",
    "强化每个项目的量化成果与业务价值表达",
  ],
  en: [
    "Reframe projects with a Staff Systems Architect tone focused on reliability",
    "Tighten all copy by 25% for crisp 30-second recruiter scannability",
    "Update accent color to deep ocean blue (#0284c7) with 16px corners",
    "Sharpen measurable outcomes and business impact across projects",
  ],
};

export function AiRefinePanel({
  lang,
  profile,
  theme,
  hostedModelId,
  providerMode,
  apiKey,
  baseUrl,
  byokModel,
  onCredits,
  onApplyProfile,
  onClose,
}: AiRefinePanelProps) {
  const isZh = lang === "zh";
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<RefineTurn[]>([]);
  const [versions, setVersions] = useState<RefineVersion[]>([
    { label: isZh ? "v0 初始" : "v0 Initial", profile },
  ]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const sendRefine = async (rawInstruction: string) => {
    const instruction = rawInstruction.trim();
    if (!instruction || busy) return;
    setBusy(true);
    setErr(null);

    const nextTurns: RefineTurn[] = [...turns, { role: "user", content: instruction }];
    setTurns(nextTurns);
    setInput("");

    try {
      const res = await fetch("/api/edit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          profile,
          instruction,
          history: turns.slice(-6),
          theme,
          hostedModelId,
          providerMode,
          ...(providerMode === "byok" && apiKey ? { apiKey, baseUrl, model: byokModel } : {}),
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        summary?: string;
        profile?: PortfolioProfile;
        credits?: CreditBalance;
        error?: string;
      };
      if (data.credits) onCredits(data.credits);
      if (!res.ok || !data.profile) {
        throw new Error(data.error || "AI refine failed.");
      }

      const summary = data.summary || (isZh ? "已按指令更新简历。" : "Updated portfolio.");
      setTurns((prev) => [...prev, { role: "assistant", content: summary }]);
      setVersions((prev) => [
        ...prev,
        { label: `v${prev.length} · ${instruction.slice(0, 12)}${instruction.length > 12 ? "…" : ""}`, profile: data.profile! },
      ]);
      onApplyProfile(data.profile);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "AI refine failed.");
      setTurns(turns);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="af-refine-panel">
      <div className="af-refine-head">
        <div className="af-refine-title">
          <Sparkles size={14} />
          <strong>{isZh ? "AI 多轮实时精修" : "AI Multi-turn Live Refine"}</strong>
          <span className="af-refine-quota">{creditCostLabel(CREDIT_COST.edit, lang, providerMode === "byok")}</span>
        </div>
        <button type="button" className="af-icon-pill" onClick={onClose} aria-label="Close AI Refine">
          <X size={13} />
        </button>
      </div>

      {versions.length > 1 && (
        <div className="af-refine-versions">
          <History size={12} />
          <span>{isZh ? "历史版本回退：" : "Rollback:"}</span>
          {versions.map((v, idx) => (
            <button
              key={idx}
              type="button"
              className="af-site-chip"
              onClick={() => {
                onApplyProfile(v.profile);
                setTurns((prev) => [
                  ...prev,
                  {
                    role: "assistant",
                    content: isZh ? `已回退到「${v.label}」` : `Restored "${v.label}"`,
                  },
                ]);
              }}
            >
              <RotateCcw size={10} />
              <span>{v.label}</span>
            </button>
          ))}
        </div>
      )}

      {turns.length === 0 ? (
        <div className="af-refine-chips">
          {(isZh ? QUICK_REFINES.zh : QUICK_REFINES.en).map((chip) => (
            <button key={chip} type="button" onClick={() => void sendRefine(chip)} disabled={busy}>
              {chip}
            </button>
          ))}
        </div>
      ) : (
        <div className="af-refine-log">
          {turns.map((t, i) => (
            <div key={i} className={`af-refine-turn is-${t.role}`}>
              <span>{t.content}</span>
            </div>
          ))}
        </div>
      )}

      {err && <div className="af-ai-error">{err}</div>}

      <form
        className="af-refine-form"
        onSubmit={(e) => {
          e.preventDefault();
          void sendRefine(input);
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            isZh
              ? "输入精修指令，例如：把第一个项目改得更有技术深度、主色换琥珀金…"
              : "Describe an edit, e.g. make project 1 more technical or change accent to amber…"
          }
          disabled={busy}
        />
        <button type="submit" className="af-btn af-btn-primary" disabled={busy || !input.trim()}>
          <Send size={13} />
          <span>{busy ? (isZh ? "精修中…" : "Editing…") : isZh ? "应用" : "Apply"}</span>
        </button>
      </form>
    </div>
  );
}
