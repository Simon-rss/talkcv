import Link from "next/link";
import type { Lang } from "../lib/schema";
import { AccountMenu } from "./account-menu";
import { PromoTopBanner } from "./promo-announcement";

export const SUPPORT_EMAIL = "rss1549596771@163.com";

export type PublicPageProps = { searchParams: Promise<{ lang?: string }> };

export function SiteLinks({ lang }: { lang: Lang }) {
  const suffix = lang === "en" ? "?lang=en" : "";
  return <nav className="af-site-links" aria-label={lang === "en" ? "TalkCV resources" : "TalkCV 相关页面"}>
    <Link href={`/pricing${suffix}`}>{lang === "en" ? "Pricing" : "会员定价"}</Link>
    <Link href={`/terms${suffix}`}>{lang === "en" ? "Terms & Refunds" : "服务条款与退款"}</Link>
    <Link href={`/terms${suffix}#aup`}>{lang === "en" ? "Acceptable Use Policy" : "可接受使用政策 (AUP)"}</Link>
    <Link href={`/privacy${suffix}`}>{lang === "en" ? "Privacy Policy" : "隐私政策"}</Link>
    <a href={`mailto:${SUPPORT_EMAIL}`}>{lang === "en" ? `Support: ${SUPPORT_EMAIL}` : `客服邮箱：${SUPPORT_EMAIL}`}</a>
  </nav>;
}

export function PublicPage({ lang, path, title, children }: { lang: Lang; path: string; title: string; children: React.ReactNode }) {
  return <>
    <PromoTopBanner lang={lang} showCta />
    <main className="af-public-page af-shell" lang={lang}>
      <header>
        <Link className="af-brand" href="/"><span className="af-brand-mark">TC</span><strong>TalkCV</strong></Link>
        <div className="af-site-links">
          <Link href={`/create?lang=${lang}`}>{lang === "en" ? "Studio" : "工作台"}</Link>
          <Link className="af-icon-pill" href={`${path}?lang=${lang === "en" ? "zh" : "en"}`}>{lang === "en" ? "中文" : "English"}</Link>
          <AccountMenu lang={lang} />
        </div>
      </header>
      <h1>{title}</h1>
      {children}
      <footer className="af-footer"><SiteLinks lang={lang} /></footer>
    </main>
  </>;
}
