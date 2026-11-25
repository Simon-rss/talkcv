import type { Metadata } from "next";
import { getSiteUrl, profile } from "../lib/profile";
import "./globals.css";

const siteUrl = getSiteUrl();

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "TalkCV — 把 PDF 简历变成会对话的 AI 个人网站 | Interactive AI Résumé Builder",
    template: "%s | TalkCV",
  },
  icons: {
    icon: "/favicon.svg",
  },
  description: "上传 PDF / Word 或简历截图，30 秒生成带 AI 问答助手、JD 匹配与扫码 A4 PDF 导出的个人交互式简历网站。",
  alternates: {
    canonical: "/",
    types: {
      "text/plain": "/llms.txt",
    },
  },
  openGraph: {
    type: "website",
    siteName: "TalkCV",
    title: "TalkCV — 把 PDF 简历变成会对话的 AI 个人网站",
    description: "上传 PDF / Word 或简历截图，30 秒生成带 AI 问答助手、JD 匹配与扫码 A4 PDF 导出的个人交互式简历网站。",
    images: ["/api/og"],
  },
  twitter: {
    card: "summary_large_image",
    title: "TalkCV — 把 PDF 简历变成会对话的 AI 个人网站",
    description: "Turn any PDF/Word/image résumé into an interactive AI portfolio website with JD matching and QR A4 PDF export.",
    images: ["/api/og"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme={profile.theme} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
