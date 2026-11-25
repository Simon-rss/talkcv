import type { Metadata } from "next";
import { getSiteUrl, profile } from "../lib/profile";
import { PortfolioHome } from "./portfolio-client";

export const metadata: Metadata = {
  title: {
    absolute: "TalkCV — 把 PDF 简历变成会对话的 AI 个人网站 | Interactive AI Résumé Builder",
  },
  description:
    "30 秒把你的 PDF / Word / 截图简历变成自带 AI 问答助手的个人网站，支持粘 JD 测匹配度、6 款一键视觉皮肤、口令隐私与带二维码 A4 PDF 导出。",
  openGraph: {
    title: "TalkCV — 把 PDF 简历变成会对话的 AI 个人网站",
    description:
      "上传 PDF / Word / 截图简历，一键生成交互式 AI 简历与作品集。首页即创始人 Simon · 任思硕真实在线样板。",
    images: ["/api/og"],
  },
  twitter: {
    card: "summary_large_image",
    title: "TalkCV — Interactive AI Résumé & Portfolio Builder",
    description:
      "Turn any PDF/DOCX résumé into a hosted bilingual interactive portfolio with cited AI Q&A, JD matching, and QR A4 PDF export.",
    images: ["/api/og"],
  },
};

export default function HomePage() {
  const siteUrl = getSiteUrl();
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: profile.basics.name.en,
    jobTitle: profile.basics.role.en,
    url: siteUrl,
    email: `mailto:${profile.basics.email}`,
    ...(profile.basics.github ? { sameAs: [profile.basics.github] } : {}),
    knowsAbout: profile.skills,
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <PortfolioHome />
    </>
  );
}
