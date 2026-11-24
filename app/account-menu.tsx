"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { readSession, type AuthUser } from "../lib/login";
import type { Lang } from "../lib/schema";

export function AccountMenu({ lang }: { lang: Lang }) {
  const zh = lang === "zh";
  const [user, setUser] = useState<AuthUser | null>(null);
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [failed, setFailed] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => readSession(controller.signal).then((current) => {
      if (!controller.signal.aborted) setUser(current);
    }).catch(() => {});
    void refresh();
    const restore = (event: PageTransitionEvent) => { if (event.persisted) void refresh(); };
    window.addEventListener("pageshow", restore);
    return () => { controller.abort(); window.removeEventListener("pageshow", restore); };
  }, []);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);

  if (!user) return <Link className="af-icon-pill af-login-pill" href={`/login?next=/create${zh ? "" : "&lang=en"}`}>
    {zh ? "登录" : "Sign in"}</Link>;
  const plan = user.isTrial ? (zh ? "PRO 体验" : "PRO TRIAL") : (user.plan ?? "free").toUpperCase();
  const language = zh ? "" : "?lang=en";
  return <div className="af-account" ref={root} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <button type="button" className="af-account-trigger" ref={trigger} aria-label={zh ? "账号菜单" : "Account menu"}
      aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>
      <span className="af-account-avatar">{user.email.charAt(0).toUpperCase()}</span>
      {plan !== "FREE" && <span className="af-account-tier">{plan}</span>}
    </button>
    {open && <nav id={panelId} className="af-account-panel" aria-label={zh ? "我的账号" : "My account"}>
      <div className="af-account-summary"><strong>{user.email}</strong><small>{plan}</small></div>
      <Link href={`/create${language}`}>{zh ? "进入工作台" : "Open Studio"}</Link>
      {user.sites.length > 0 && <div className="af-account-sites"><small>{zh ? "已发布站点" : "Published sites"}</small>
        {user.sites.map((slug) => <Link key={slug} href={`/u/${encodeURIComponent(slug)}`}>/u/{slug}</Link>)}</div>}
      <Link href={`/pricing${language}`}>{zh ? "会员方案" : "Plans & pricing"}</Link>
      <button type="button" disabled={signingOut} onClick={async () => {
        setSigningOut(true); setFailed(false);
        try {
          const res = await fetch("/api/auth/logout", { method: "POST" });
          if (!res.ok) throw new Error();
          setOpen(false); setUser(null); window.location.reload();
        } catch { setFailed(true); setSigningOut(false); }
      }}>{zh ? "退出登录" : "Sign out"}</button>
      {failed && <small role="alert">{zh ? "退出失败，请重试。" : "Could not sign out. Try again."}</small>}
    </nav>}
  </div>;
}
