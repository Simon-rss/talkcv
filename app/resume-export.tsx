"use client";
import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { publishedSiteUrl, siteQrDataUrl } from "../lib/site-qr.mjs";
import { localize, type Lang, type PortfolioProfile } from "../lib/schema";

export function ResumeExport({ profile, slug, lang }: { profile: PortfolioProfile; slug?: string; lang: Lang }) {
  const [qr, setQr] = useState<{ slug: string; src: string } | null>(null);
  useEffect(() => {
    if (!slug) return;
    let current = true;
    siteQrDataUrl(slug).then((src) => { if (current) setQr({ slug, src }); });
    return () => { current = false; };
  }, [slug]);
  const zh = lang === "zh";
  const basics = profile.basics;
  const qrSrc = qr?.slug === slug ? qr?.src : undefined;
  const details = [
    localize(basics.location, lang),
    basics.email,
    basics.wechat && `${zh ? "微信" : "WeChat"} · ${basics.wechat}`,
    basics.linkedin,
    basics.github,
    basics.portfolio,
  ].filter(Boolean);

  return (
    <>
      <div className="af-export-action af-shell">
        <button type="button" className="af-btn af-btn-secondary" disabled={!qrSrc} onClick={() => window.print()}>
          <Printer size={16} />{zh ? "导出 PDF 简历" : "Export PDF résumé"}
        </button>
        {!slug && <small>{zh ? "请先在工作台填写站点网址。" : "Choose a site handle in Studio first."}</small>}
      </div>
      <article className="af-print-resume" lang={lang}>
        <header>
          <div>
            <h1>{localize(basics.name, lang)}</h1>
            <p className="af-print-role">{localize(basics.role, lang)}</p>
            <p className="af-print-meta">{details.join("  ·  ")}</p>
          </div>
          {qrSrc && slug && (
            <figure>
              {/* QR generated locally for the canonical published URL. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img width="88" height="88" src={qrSrc} alt={publishedSiteUrl(slug)} />
              <figcaption>{zh ? "扫码问 AI / 测 JD 匹配" : "Scan to ask AI / match JD"}</figcaption>
            </figure>
          )}
        </header>
        {localize(basics.headline, lang) && <p className="af-print-headline">{localize(basics.headline, lang)}</p>}
        {localize(basics.intro, lang) && <p className="af-print-intro">{localize(basics.intro, lang)}</p>}
        {profile.skills.length > 0 && (
          <section>
            <h2>{zh ? "核心技能" : "Skills"}</h2>
            <p>{profile.skills.join(" · ")}</p>
          </section>
        )}
        {profile.experiences.length > 0 && (
          <section>
            <h2>{zh ? "工作经历" : "Experience"}</h2>
            {profile.experiences.map((exp, i) => (
              <div key={i} className="af-print-entry">
                <div className="af-print-entry-head">
                  <h3>{localize(exp.company, lang)} · {localize(exp.role, lang)}</h3>
                  <small>{exp.period}</small>
                </div>
                <p>{localize(exp.summary, lang)}</p>
              </div>
            ))}
          </section>
        )}
        {profile.projects.length > 0 && (
          <section>
            <h2>{zh ? "代表项目" : "Projects"}</h2>
            {profile.projects.map((p) => {
              const bulletItems = (p.sections ?? []).flatMap((sec) => sec.items ?? []).slice(0, 3);
              return (
                <div key={p.slug} className="af-print-entry">
                  <div className="af-print-entry-head">
                    <h3>{localize(p.title, lang)}</h3>
                    {localize(p.role, lang) && <small>{localize(p.role, lang)}</small>}
                  </div>
                  <p>{localize(p.summary, lang)} {localize(p.outcome, lang)}</p>
                  {p.facts?.length > 0 && (
                    <div className="af-print-facts">
                      {p.facts.slice(0, 4).map((f) => (
                        <span key={f.value + f.label.en}>
                          <strong>{f.value}</strong> {localize(f.label, lang)}
                        </span>
                      ))}
                    </div>
                  )}
                  {bulletItems.length > 0 && (
                    <ul className="af-print-items">
                      {bulletItems.map((item, idx) => (
                        <li key={idx}>{localize(item, lang)}</li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </section>
        )}
        {localize(basics.education, lang) && (
          <section>
            <h2>{zh ? "教育背景" : "Education"}</h2>
            <p>{localize(basics.education, lang)}</p>
          </section>
        )}
      </article>
    </>
  );
}
