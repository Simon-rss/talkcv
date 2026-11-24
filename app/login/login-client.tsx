"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { captureReferral, clearPendingReferral, readSession, type AuthUser } from "../../lib/login";
import { isValidTheme, type Lang, type ThemeId } from "../../lib/schema";

interface LoginFormProps {
  lang: Lang;
  referralCode: string;
  onVerified: (user: AuthUser) => void;
  intent?: "generate" | "publish" | null;
}

function EmailLoginForm({ lang, referralCode, onVerified, intent }: LoginFormProps) {
  const zh = lang === "zh";
  const [email, setEmail] = useState("");
  const [challenge, setChallenge] = useState("");
  const [code, setCode] = useState("");
  const [instant, setInstant] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => { if (challenge) codeInput.current?.focus(); }, [challenge]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setError(""); setBusy(true);
    try {
      const verify = Boolean(challenge);
      const res = await fetch(verify ? "/api/auth/verify" : "/api/auth/send-code", {
        method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal,
        body: JSON.stringify(verify ? { email, code, challenge, ...(referralCode && { referralCode }) } : { email }),
      });
      const data = await res.json();
      if (controller.signal.aborted) return;
      if (!res.ok || !(verify ? data.user : data.challenge)) {
        if (!zh && data.error) setError(data.error);
        else if (res.status === 429) setError(zh ? "请等待 30 秒后再获取验证码。" : "Wait 30 seconds before requesting another code.");
        else if (res.status === 401) setError(zh ? "验证码有误或已过期，请检查或重新获取。" : "Check the code or request a new one.");
        else if (res.status === 400) setError(zh ? "请检查邮箱和验证码。" : "Check the email address and verification code.");
        else setError(zh ? "暂时无法登录，请稍后重试。" : "Sign-in is unavailable. Please try again.");
      } else if (verify) {
        clearPendingReferral();
        onVerified(data.user);
      } else {
        setChallenge(data.challenge);
        setCode(data.instantCode ?? "");
        setInstant(Boolean(data.instantCode));
      }
    } catch {
      if (!controller.signal.aborted) setError(zh ? "连接失败，请重试。" : "Could not connect. Please try again.");
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return <form className="af-auth-form" onSubmit={submit}>
    {challenge ? <>
      <p role="status">{instant ? (zh ? "本地测试验证码已自动填入。" : "Your local test code has been filled in.") :
        (zh ? `验证码已发送至 ${email}，10 分钟内有效。` : `We sent a code to ${email}. It expires in 10 minutes.`)}</p>
      <label>{zh ? "6 位验证码" : "6-digit verification code"}
        <input ref={codeInput} type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}"
          required maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} /></label>
    </> : <>
      <p>{intent === "generate" ? (zh ? "登录后会继续用当前草稿生成简历网站。" : "Sign in to continue generating your site from this draft.") :
        intent === "publish" ? (zh ? "登录后会按当前设置发布这份简历。" : "Sign in to publish this résumé with the settings you selected.") :
        (zh ? "使用邮箱登录，创建并管理你的交互简历。" : "Sign in with your email to create and manage your interactive résumé.")}</p>
      <label>{zh ? "邮箱" : "Email address"}
        <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></label>
    </>}
    {error && <p className="af-ai-error" role="alert">{error}</p>}
    <button type="submit" className="af-btn af-btn-primary" disabled={busy}>
      {busy ? (zh ? "处理中…" : "Please wait…") : challenge ? (zh ? "确认登录" : "Verify & sign in") : (zh ? "获取 6 位验证码" : "Send 6-digit code")}
    </button>
    {challenge && <button type="button" className="af-inline-link" disabled={busy} onClick={() => {
      setChallenge(""); setCode(""); setError("");
    }}>{zh ? "更换邮箱或重新获取验证码" : "Change email or request a new code"}</button>}
  </form>;
}

export function StudioLoginDialog({ onClose, ...form }: LoginFormProps & { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = dialog.current!;
    el.showModal();
    el.querySelector("input")?.focus({ preventScroll: true });
    return () => el.close();
  }, []);
  return <dialog ref={dialog} className="af-login-dialog" aria-labelledby="studio-login-title"
    onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="af-auth-modal">
      <div className="af-auth-head">
        <strong id="studio-login-title">{form.lang === "zh" ? "邮箱验证码登录" : "Sign in with email"}</strong>
        <button type="button" onClick={onClose} aria-label={form.lang === "zh" ? "关闭登录" : "Close sign-in"}><X size={16} /></button>
      </div>
      <EmailLoginForm {...form} />
    </div>
  </dialog>;
}

export function LoginClient({ initialLang, next, referral }: { initialLang: Lang; next: string; referral: string | null }) {
  const [lang, setLang] = useState(initialLang);
  const [theme, setTheme] = useState<ThemeId>();
  const [referralCode, setReferralCode] = useState(referral ?? "");
  const destination = lang === "en" && next === "/create" ? "/create?lang=en" : next;
  const zh = lang === "zh";
  useEffect(() => {
    const controller = new AbortController();
    const frame = requestAnimationFrame(() => {
      let saved: string | null = null;
      try { saved = localStorage.getItem("talkcv-theme"); } catch { /* Use the system theme. */ }
      setTheme(isValidTheme(saved) ? saved : matchMedia("(prefers-color-scheme: dark)").matches ? "terminal" : "editorial");
    });
    readSession(controller.signal)
      .then((user) => {
        if (controller.signal.aborted) return;
        if (user) {
          window.location.replace(destination);
          return;
        }
        setReferralCode(captureReferral(referral));
      })
      .catch(() => {
        if (!controller.signal.aborted) setReferralCode(captureReferral(referral));
      });
    return () => { controller.abort(); cancelAnimationFrame(frame); };
  }, [referral, destination]);

  return <main className="af-login-page" lang={lang} data-theme={theme}>
    <header className="af-header">
      <Link className="af-brand" href="/"><span className="af-brand-mark">TC</span><strong>TalkCV</strong></Link>
      <button type="button" className="af-icon-pill" onClick={() => {
        const nextLang = zh ? "en" : "zh";
        setLang(nextLang);
        const url = new URL(location.href);
        url.searchParams.set("lang", nextLang);
        history.replaceState(null, "", url);
      }}>{zh ? "English" : "中文"}</button>
    </header>
    <div className="af-login-content">
      <section className="af-auth-modal"><div className="af-auth-head"><h1>{zh ? "登录 TalkCV" : "Sign in to TalkCV"}</h1></div>
        <EmailLoginForm lang={lang} referralCode={referralCode} onVerified={() => window.location.replace(destination)} />
      </section>
    </div>
  </main>;
}
