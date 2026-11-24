"use client";

import { useState } from "react";
import { CREDIT_COST, creditCostLabel, type CreditBalance } from "../../lib/credits";
import type { Lang, PortfolioProfile } from "../../lib/schema";
import type { OutreachResult } from "../../worker/outreach";

interface Props {
  lang: Lang;
  profile?: PortfolioProfile;
  signedIn: boolean;
  onSignIn: () => void;
  onCredits: (credits: CreditBalance) => void;
  provider: { providerMode: "hosted" | "byok"; hostedModelId: string; apiKey?: string; baseUrl?: string; model?: string };
}

export function OutreachPanel({ lang, profile, signedIn, onSignIn, onCredits, provider }: Props) {
  const zh = lang === "zh";
  const [jd, setJd] = useState("");
  const [style, setStyle] = useState("boss");
  const [result, setResult] = useState<{ profile: PortfolioProfile; value: OutreachResult }>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(0);
  const [copied, setCopied] = useState<"yes" | "manual">();
  const draft = result?.profile === profile ? result?.value : undefined;
  const errors: Record<number, string> = {
    400: zh ? "请检查当前简历、岗位描述和所选写作风格。" : "Check your résumé, job description and style.",
    401: zh ? "请确认登录状态和自有 API Key。" : "Check your sign-in and your API key.",
    403: zh ? "当前套餐无法使用所选模型，请切换模型。" : "Choose a model available on your plan.",
    429: zh ? "创作点数不足，请查看余额或使用自有 Key。" : "Insufficient credits. Check your balance or use your own key.",
    503: zh ? "所选托管模型尚未配置，请更换模型。" : "This hosted model is not configured. Choose another model.",
  };
  return <details className="af-outreach">
    <summary>{zh ? "按 JD 生成求职开场白 / 求职信" : "Write a greeting or cover letter for a job"}</summary>
    <form onSubmit={async (event) => {
      event.preventDefault();
      if (!signedIn) { onSignIn(); return; }
      if (!profile || busy) return;
      setBusy(true); setStatus(0); setResult(undefined); setCopied(undefined);
      try {
        const res = await fetch("/api/outreach", { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ profile, jdText: jd.trim(), style, lang, ...provider }) });
        const data = await res.json();
        if (data.credits) onCredits(data.credits);
        if (res.ok) setResult({ profile, value: data });
        else setStatus(res.status);
      } catch { setStatus(502); }
      finally { setBusy(false); }
    }}>
      <label>{zh ? "目标岗位描述" : "Target job description"}
        <textarea className="af-textarea" rows={4} maxLength={8000} required disabled={busy} value={jd}
          onChange={(event) => { setJd(event.target.value); setResult(undefined); setStatus(0); }} /></label>
      <label>{zh ? "文案风格" : "Writing style"}<select className="af-select" value={style} disabled={busy}
        onChange={(event) => { setStyle(event.target.value); setResult(undefined); setStatus(0); }}>
        <option value="boss">{zh ? "BOSS 直聘 / 微信开场白" : "BOSS / WeChat greeting"}</option>
        <option value="email">{zh ? "正式邮件求职信" : "Formal email cover letter"}</option>
      </select></label>
      {!profile && <p>{zh ? "请先生成简历或载入已发布的站点。" : "Generate a résumé or load a published site first."}</p>}
      <button className="af-btn af-btn-primary" disabled={busy || !jd.trim() || !profile}>
        {!signedIn ? (zh ? "登录后生成" : "Sign in to generate") : busy ? (zh ? "正在生成…" : "Generating…") : (zh ? "生成文案" : "Generate draft")} · {creditCostLabel(CREDIT_COST.outreach, lang, provider.providerMode === "byok")}
      </button>
      {status > 0 && <p role="alert">{errors[status] ?? (zh ? "未能生成符合简历资料的文案，请重试。" : "Could not generate a grounded draft. Please retry.")}</p>}
    </form>
    {draft && <div className="af-outreach-result" aria-live="polite">
      <h3>{zh ? "匹配要点" : "Matching points"}</h3><ul>{draft.matches.map((s, i) => <li key={i}>{s}</li>)}</ul>
      <h3>{zh ? "可补强之处" : "Ways to strengthen your application"}</h3><ul>{draft.improvements.map((s, i) => <li key={i}>{s}</li>)}</ul>
      <h3>{zh ? "可发送正文" : "Ready to send"}</h3><p className="af-outreach-body">{draft.body}</p>
      <button type="button" className="af-icon-pill" onClick={async () => {
        try { await navigator.clipboard.writeText(draft.body); setCopied("yes"); }
        catch { setCopied("manual"); }
      }}>{copied === "yes" ? (zh ? "已复制" : "Copied") : (zh ? "复制正文" : "Copy message")}</button>
      {copied === "manual" && <p role="status">{zh ? "请选中正文并手动复制。" : "Select the message and copy it manually."}</p>}
    </div>}
  </details>;
}
