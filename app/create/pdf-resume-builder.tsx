"use client";

import { Download, FileText, Printer, RotateCcw, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CREDIT_COST, creditCostLabel, type CreditBalance } from "../../lib/credits";
import {
  profileToDefaultResumePdfPlan,
  renderResumePdfHtml,
  RESUME_PDF_ACCENTS,
  RESUME_PDF_TEMPLATES,
} from "../../lib/pdf-resume-templates.mjs";
import type { Lang, PortfolioProfile } from "../../lib/schema";
import { publishedSiteUrl, siteQrDataUrl } from "../../lib/site-qr.mjs";

interface PdfResumeBuilderProps {
  profile: PortfolioProfile;
  slug?: string;
  lang: Lang;
  providerMode: "hosted" | "byok";
  hostedModelId: string;
  apiKey: string;
  baseUrl: string;
  byokModel: string;
  isSignedIn: boolean;
  onRequireAuth: () => void;
  onRequirePricing: () => void;
  onCredits: (credits: CreditBalance) => void;
  triggerLabel?: string;
  triggerClassName?: string;
}

export function PdfResumeBuilder({
  profile,
  slug,
  lang,
  providerMode,
  hostedModelId,
  apiKey,
  baseUrl,
  byokModel,
  isSignedIn,
  onRequireAuth,
  onRequirePricing,
  onCredits,
  triggerLabel,
  triggerClassName,
}: PdfResumeBuilderProps) {
  const zh = lang === "zh";
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState(() => profileToDefaultResumePdfPlan(profile, lang));
  const [targetRole, setTargetRole] = useState("");
  const [targetJd, setTargetJd] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfErr, setPdfErr] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Sync default plan when modal opens freshly (preserve AI-tailored plan while open)
  const openModal = () => {
    setPlan((prev) =>
      prev.aiNote
        ? prev
        : profileToDefaultResumePdfPlan(profile, lang, {
            template: prev.template,
            accentColor: prev.accentColor,
            targetPages: prev.targetPages,
            showQr: prev.showQr,
          }),
    );
    setAiErr(null);
    setPdfErr(null);
    setOpen(true);
  };

  useEffect(() => {
    if (!open || !slug) {
      setQrDataUrl("");
      return;
    }
    let active = true;
    siteQrDataUrl(slug)
      .then((src) => {
        if (active) setQrDataUrl(src);
      })
      .catch(() => {
        if (active) setQrDataUrl("");
      });
    return () => {
      active = false;
    };
  }, [open, slug]);

  const previewHtml = useMemo(
    () =>
      renderResumePdfHtml(plan, {
        qrDataUrl: slug ? qrDataUrl : "",
        siteUrl: slug ? publishedSiteUrl(slug) : "",
        avatarUrl: profile.basics.avatar || "",
      }),
    [plan, profile.basics.avatar, qrDataUrl, slug],
  );

  const runAiReflow = async () => {
    if (providerMode !== "byok" && !isSignedIn) {
      onRequireAuth();
      return;
    }
    if (providerMode === "byok" && !apiKey.trim()) {
      setAiErr(zh ? "请先在工作台左侧填写你的 API Key。" : "Enter your API key in Studio first.");
      return;
    }
    setAiBusy(true);
    setAiErr(null);
    try {
      const res = await fetch("/api/pdf-resume/ai-plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          profile,
          lang,
          targetPages: plan.targetPages,
          template: plan.template,
          accentColor: plan.accentColor,
          showQr: plan.showQr,
          targetRole: targetRole.trim(),
          targetJd: targetJd.trim(),
          providerMode,
          hostedModelId,
          ...(providerMode === "byok" ? { apiKey, baseUrl, model: byokModel } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        plan?: typeof plan;
        credits?: CreditBalance;
        error?: string;
      };
      if (data.credits) onCredits(data.credits);
      if (res.status === 401) {
        onRequireAuth();
        return;
      }
      if (res.status === 402 || res.status === 403) {
        onRequirePricing();
        throw new Error(data.error || (zh ? "点数不足或需要升级套餐" : "Insufficient credits or plan upgrade required."));
      }
      if (!res.ok || !data.plan) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setPlan(data.plan);
    } catch (err) {
      setAiErr(err instanceof Error ? err.message : zh ? "AI 重排失败，请重试。" : "AI reflow failed.");
    } finally {
      setAiBusy(false);
    }
  };

  const triggerBrowserPrint = () => {
    const win = iframeRef.current?.contentWindow;
    if (win) {
      win.focus();
      win.print();
    }
  };

  const downloadPdf = async () => {
    setPdfBusy(true);
    setPdfErr(null);
    try {
      const res = await fetch("/api/pdf-resume/render", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          plan,
          slug: slug || "",
          avatarUrl: profile.basics.avatar || "",
        }),
      });
      if (res.status === 501) {
        // Headless Chromium unavailable in local/worker-only mode: fall back cleanly to print dialog
        triggerBrowserPrint();
        return;
      }
      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safeName = (plan.name || "TalkCV-Resume").replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]+/g, "-").slice(0, 40);
      a.download = `${safeName || "TalkCV"}-Resume.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (err) {
      setPdfErr(
        err instanceof Error
          ? `${err.message} ${zh ? "（可点击右侧「浏览器打印」备用导出）" : "(use Browser Print as fallback)"}`
          : zh
            ? "PDF 生成失败，请使用浏览器打印导出。"
            : "PDF generation failed. Use Browser Print instead.",
      );
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={triggerClassName || "af-icon-pill af-login-pill"}
        onClick={openModal}
        title={
          zh
            ? "AI 按岗位重排 STAR 亮点，4 套专业 A4 模板一键直接下载 PDF 简历"
            : "AI-reflow your résumé into 4 pro A4 templates and download PDF directly"
        }
      >
        <FileText size={12} />
        <span>{triggerLabel || (zh ? "AI 重排 PDF 简历" : "AI PDF Résumé")}</span>
      </button>

      {open && (
        <div className="af-modal-backdrop" role="dialog" aria-modal="true" onClick={() => setOpen(false)}>
          <div
            className="af-modal-card"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(1160px, 96vw)",
              maxHeight: "92vh",
              padding: 0,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "14px 18px",
                borderBottom: "1px solid var(--line)",
                background: "var(--surface)",
              }}
            >
              <div>
                <h3 style={{ margin: 0, fontSize: 16, display: "flex", alignItems: "center", gap: 8 }}>
                  <FileText size={16} />
                  {zh ? "AI 一键重排 A4 PDF 简历" : "AI A4 PDF Résumé Builder"}
                </h3>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--ink-soft)" }}>
                  {zh
                    ? "4 套专业 A4 版式实时切换 · AI 按目标岗位精炼 STAR 亮点与控页数 · 一键直出矢量 PDF"
                    : "4 designer A4 templates · AI STAR rewrite & page budgeting · 1-click vector PDF download"}
                </p>
              </div>
              <button type="button" className="af-icon-pill" onClick={() => setOpen(false)} aria-label="Close">
                <X size={14} />
              </button>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(310px, 370px) 1fr",
                flex: "1 1 auto",
                minHeight: 0,
                overflow: "hidden",
              }}
            >
              {/* Left control column */}
              <div
                style={{
                  padding: "14px 16px",
                  borderRight: "1px solid var(--line)",
                  overflowY: "auto",
                  display: "flex",
                  flexDirection: "column",
                  gap: 14,
                  background: "var(--bg)",
                }}
              >
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
                    {zh ? "1. 选择 A4 排版风格" : "1. Choose A4 Template"}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {RESUME_PDF_TEMPLATES.map((tpl) => {
                      const active = plan.template === tpl.id;
                      return (
                        <button
                          key={tpl.id}
                          type="button"
                          onClick={() =>
                            setPlan((prev) => ({
                              ...prev,
                              template: tpl.id,
                              accentColor: tpl.defaultAccent,
                            }))
                          }
                          style={{
                            textAlign: "left",
                            padding: "8px 10px",
                            borderRadius: 10,
                            border: active ? "1.5px solid var(--accent)" : "1px solid var(--line)",
                            background: active ? "color-mix(in srgb, var(--accent) 10%, var(--surface))" : "var(--surface)",
                            color: "var(--ink)",
                            cursor: "pointer",
                          }}
                        >
                          <div style={{ fontSize: 12.5, fontWeight: 700 }}>{tpl.label[lang]}</div>
                          <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 2, lineHeight: 1.3 }}>
                            {tpl.desc[lang]}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                      {zh ? "目标页数" : "Page Budget"}
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      {([1, 2] as const).map((n) => (
                        <button
                          key={n}
                          type="button"
                          className={`af-icon-pill ${plan.targetPages === n ? "af-login-pill" : ""}`}
                          style={{ flex: 1, justifyContent: "center" }}
                          onClick={() =>
                            setPlan((prev) => ({
                              ...prev,
                              targetPages: n,
                              density: n === 1 ? "compact" : "balanced",
                            }))
                          }
                        >
                          {n === 1 ? (zh ? "1 页精华" : "1 Page") : zh ? "2 页完整" : "2 Pages"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                      {zh ? "排版密度" : "Density"}
                    </div>
                    <div style={{ display: "flex", gap: 4 }}>
                      {(
                        [
                          ["compact", zh ? "紧凑" : "Tight"],
                          ["balanced", zh ? "标准" : "Std"],
                          ["spacious", zh ? "舒展" : "Airy"],
                        ] as const
                      ).map(([id, label]) => (
                        <button
                          key={id}
                          type="button"
                          className={`af-icon-pill ${plan.density === id ? "af-login-pill" : ""}`}
                          style={{ flex: 1, justifyContent: "center", paddingInline: 6 }}
                          onClick={() => setPlan((prev) => ({ ...prev, density: id }))}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                    {zh ? "强调色" : "Accent Color"}
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {RESUME_PDF_ACCENTS.map((c) => (
                      <button
                        key={c.hex}
                        type="button"
                        title={c.label[lang]}
                        onClick={() => setPlan((prev) => ({ ...prev, accentColor: c.hex }))}
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 999,
                          background: c.hex,
                          border: plan.accentColor === c.hex ? "2.5px solid var(--ink)" : "1.5px solid rgba(0,0,0,0.15)",
                          cursor: "pointer",
                        }}
                      />
                    ))}
                  </div>
                </div>

                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 12.5,
                    color: "var(--ink)",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={plan.showQr}
                    disabled={!slug}
                    onChange={(e) => setPlan((prev) => ({ ...prev, showQr: e.target.checked }))}
                  />
                  <span>
                    {slug
                      ? zh
                        ? "附带 AI 交互分身二维码（HR 扫码直连你的个人站）"
                        : "Include AI Twin QR code linking to your live site"
                      : zh
                        ? "发布专属链接后自动附带 AI 分身二维码"
                        : "Publish your site handle to attach an AI Twin QR"}
                  </span>
                </label>

                <div
                  style={{
                    padding: 12,
                    borderRadius: 12,
                    border: "1px solid var(--line)",
                    background: "var(--surface)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  <div style={{ fontSize: 12.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                    <Sparkles size={14} />
                    {zh ? "2. AI 智能重排与 STAR 精炼（可选）" : "2. AI Reflow & STAR Polish (Optional)"}
                  </div>
                  <input
                    type="text"
                    value={targetRole}
                    onChange={(e) => setTargetRole(e.target.value)}
                    placeholder={zh ? "目标岗位（可选，如：AI 应用开发工程师）" : "Target role (optional, e.g. Senior AI Engineer)"}
                    style={{
                      width: "100%",
                      padding: "7px 10px",
                      borderRadius: 8,
                      border: "1px solid var(--line)",
                      background: "var(--bg)",
                      color: "var(--ink)",
                      fontSize: 12.5,
                    }}
                  />
                  <textarea
                    rows={3}
                    value={targetJd}
                    onChange={(e) => setTargetJd(e.target.value)}
                    placeholder={
                      zh
                        ? "粘贴目标岗位 JD（可选）：AI 会自动重排模块顺序、提炼量化指标并压进所选页数"
                        : "Paste target JD (optional): AI reorders sections, sharpens STAR metrics, and fits your page budget"
                    }
                    style={{
                      width: "100%",
                      padding: "7px 10px",
                      borderRadius: 8,
                      border: "1px solid var(--line)",
                      background: "var(--bg)",
                      color: "var(--ink)",
                      fontSize: 12,
                      resize: "vertical",
                    }}
                  />
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      className="af-btn af-btn-primary"
                      style={{ flex: 1, justifyContent: "center", fontSize: 12.5, padding: "8px 12px" }}
                      disabled={aiBusy}
                      onClick={() => void runAiReflow()}
                    >
                      <Sparkles size={13} />
                      {aiBusy
                        ? zh
                          ? "AI 正在重排精炼…"
                          : "Reflowing…"
                        : zh
                          ? `AI 智能重排 · ${creditCostLabel(CREDIT_COST.edit, lang, providerMode === "byok")}`
                          : `AI Reflow · ${creditCostLabel(CREDIT_COST.edit, lang, providerMode === "byok")}`}
                    </button>
                    {plan.aiNote && (
                      <button
                        type="button"
                        className="af-icon-pill"
                        title={zh ? "恢复默认原文" : "Reset to source profile"}
                        onClick={() =>
                          setPlan(
                            profileToDefaultResumePdfPlan(profile, lang, {
                              template: plan.template,
                              accentColor: plan.accentColor,
                              targetPages: plan.targetPages,
                              showQr: plan.showQr,
                            }),
                          )
                        }
                      >
                        <RotateCcw size={12} />
                      </button>
                    )}
                  </div>
                  {plan.aiNote && (
                    <div
                      style={{
                        fontSize: 11.5,
                        color: "var(--accent)",
                        background: "color-mix(in srgb, var(--accent) 8%, transparent)",
                        padding: "6px 8px",
                        borderRadius: 8,
                        lineHeight: 1.4,
                      }}
                    >
                      ✨ {plan.aiNote}
                    </div>
                  )}
                  {aiErr && <div style={{ fontSize: 11.5, color: "#dc2626" }}>{aiErr}</div>}
                </div>

                <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
                  <button
                    type="button"
                    className="af-btn af-btn-primary"
                    style={{ width: "100%", justifyContent: "center", padding: "10px 14px", fontSize: 13.5 }}
                    disabled={pdfBusy}
                    onClick={() => void downloadPdf()}
                  >
                    <Download size={15} />
                    {pdfBusy
                      ? zh
                        ? "正在生成高清 A4 PDF…"
                        : "Rendering A4 PDF…"
                      : zh
                        ? "一键下载高清 A4 PDF"
                        : "Download A4 PDF"}
                  </button>
                  <button
                    type="button"
                    className="af-btn af-btn-secondary"
                    style={{ width: "100%", justifyContent: "center", padding: "7px 12px", fontSize: 12 }}
                    onClick={triggerBrowserPrint}
                  >
                    <Printer size={13} />
                    {zh ? "浏览器打印 / 另存为 PDF" : "Browser Print / Save as PDF"}
                  </button>
                  {pdfErr && <div style={{ fontSize: 11.5, color: "#dc2626" }}>{pdfErr}</div>}
                </div>
              </div>

              {/* Right live A4 preview */}
              <div
                style={{
                  background: "#e2e8f0",
                  padding: 18,
                  overflowY: "auto",
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "flex-start",
                }}
              >
                <div
                  style={{
                    width: "210mm",
                    minHeight: "297mm",
                    background: "#ffffff",
                    boxShadow: "0 16px 40px rgba(15, 23, 42, 0.18)",
                    borderRadius: 4,
                    overflow: "hidden",
                    transformOrigin: "top center",
                  }}
                >
                  <iframe
                    ref={iframeRef}
                    title="A4 PDF Resume Preview"
                    srcDoc={previewHtml}
                    style={{
                      width: "210mm",
                      height: plan.targetPages === 2 ? "594mm" : "297mm",
                      border: "none",
                      display: "block",
                      background: "#ffffff",
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
