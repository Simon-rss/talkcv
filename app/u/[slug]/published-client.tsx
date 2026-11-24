"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { PortfolioProfile } from "../../../lib/schema";
import { PortfolioHome } from "../../portfolio-client";

type Status = "loading" | "ready" | "locked" | "expired" | "not_found";

export function PublishedProfileClient({ slug, initialStatus }: { slug: string; initialStatus: Exclude<Status, "ready"> }) {
  const [passcode, setPasscode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lang, setLang] = useState<"zh" | "en">("zh");
  const zh = lang === "zh";
  const changeLanguage = () => {
    const next = zh ? "en" : "zh";
    setLang(next);
    localStorage.setItem("talkcv-lang", next);
  };
  const languageButton = <button type="button" className="af-icon-pill" onClick={changeLanguage}>{zh ? "English" : "中文"}</button>;
  const [profile, setProfile] = useState<PortfolioProfile | null>(null);
  const [ownerRefCode, setOwnerRefCode] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<Status>(initialStatus);

  useEffect(() => {
    if (status !== "loading") return;
    let active = true;
    fetch(`/api/profiles/${encodeURIComponent(slug)}`)
      .then(async (res) => {
        if (res.status === 401) {
          if (active) setStatus("locked");
          return null;
        }
        if (res.status === 410) {
          if (active) setStatus("expired");
          return null;
        }
        if (!res.ok) throw new Error("not found");
        return (await res.json()) as { profile: PortfolioProfile; ownerRefCode?: string };
      })
      .then((data) => {
        if (!active || !data) return;
        setProfile(data.profile);
        setOwnerRefCode(data.ownerRefCode);
        setStatus("ready");
        const name = data.profile.basics?.name?.zh || data.profile.basics?.name?.en || slug;
        document.title = `${name} · 个人交互简历`;
      })
      .catch(() => {
        if (active) setStatus("not_found");
      });
    return () => {
      active = false;
    };
  }, [slug, status]);

  if (status === "locked") {
    return <main className="af-lock-page" lang={lang}>
      <form className="af-auth-modal" onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        try {
          const res = await fetch(`/api/profiles/${encodeURIComponent(slug)}/unlock`, { method: "POST",
            headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode }) });
          if (res.ok) {
            setPasscode("");
            localStorage.setItem("talkcv-lang", lang);
            window.location.reload();
          } else {
            setError(res.status === 429 ? "limited" : "incorrect");
          }
        } catch { setError("network"); }
        finally { setBusy(false); }
      }}>
        <div className="af-auth-head"><strong>TalkCV</strong>{languageButton}</div>
        <h1>{zh ? "此简历需要访问口令" : "This résumé is passcode protected"}</h1>
        <label className="af-field-label">{zh ? "输入作者分享的口令" : "Enter the passcode from the owner"}
          <input type="password" autoComplete="off" required maxLength={8} value={passcode} onChange={(e) => setPasscode(e.target.value)} />
        </label>
        {error && <p role="alert">{error === "limited" ? (zh ? "尝试过于频繁，请在 10 分钟后重试。" : "Too many attempts. Try again in 10 minutes.") :
          error === "network" ? (zh ? "连接失败，请重试。" : "Connection failed. Please try again.") : (zh ? "口令不正确。" : "Incorrect passcode.")}</p>}
        <button className="af-btn af-btn-primary" disabled={busy}>{zh ? "解锁简历" : "Unlock résumé"}</button>
      </form>
    </main>;
  }

  if (status === "loading") {
    return (
      <main className="af-shell af-not-found">
        <p className="af-eyebrow">TALKCV</p>
        <p>{zh ? `正在加载 @${slug}…` : `Loading @${slug}…`}</p>
      </main>
    );
  }

  if (status === "expired" || status === "not_found" || !profile) {
    const expired = status === "expired";
    return <main className="af-shell af-not-found" lang={lang}>
      {languageButton}
      <h1>{expired ? (zh ? "站点托管已到期" : "Hosting has expired") : (zh ? "404 · 站点未发布" : "404 · Site not published")}</h1>
      <p className="af-intro">{expired
        ? (zh ? "作者可以登录工作台重新发布这份简历。" : "The owner can republish this résumé from Studio.")
        : (zh ? `目前没有可访问的 /u/${slug} 站点。` : `There is no published site at /u/${slug}.`)}</p>
      <Link className="af-btn af-btn-primary" href={`/create?handle=${encodeURIComponent(slug)}&lang=${lang}`}>{zh ? "打开工作台" : "Open TalkCV Studio"}</Link>
    </main>;
  }

  return <PortfolioHome initialProfile={profile} profileSlug={slug} ownerRefCode={ownerRefCode} />;
}
