"use client";
import { useState } from "react";
import { Copy, ExternalLink, Mail } from "lucide-react";
import { normalizeContacts } from "../lib/contacts.mjs";
import type { Lang, PortfolioProfile } from "../lib/schema";

export function ContactLinks({ basics, lang }: { basics: PortfolioProfile["basics"]; lang: Lang }) {
  const { email, github, linkedin, portfolio, wechat } = normalizeContacts(basics);
  const [message, setMessage] = useState("");
  const zh = lang === "zh";
  return <div className="af-actions af-contacts">
    {email && <a className="af-btn af-btn-primary" href={`mailto:${email}`}><Mail size={15} />{email}</a>}
    {[[github, "GitHub"], [linkedin, "LinkedIn"], [portfolio, zh ? "博客 / 作品集" : "Blog / Portfolio"]].map(([href, label]) =>
      href && <a key={label} className="af-btn af-btn-secondary" href={href} target="_blank" rel="noreferrer">{label}<ExternalLink size={14} /></a>)}
    {wechat && <button type="button" className="af-btn af-btn-secondary" onClick={async () => {
      try {
        await navigator.clipboard.writeText(wechat);
        setMessage(zh ? "微信号已复制" : "WeChat ID copied");
      } catch {
        setMessage(zh ? `请手动复制微信号 ${wechat}` : `Copy WeChat ID: ${wechat}`);
      }
    }}><Copy size={14} />{zh ? "微信" : "WeChat"} · {wechat}</button>}
    {wechat && message && <small role="status">{message}</small>}
  </div>;
}
