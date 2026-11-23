import type { Metadata } from "next";
import { getSiteUrl, profile } from "../lib/profile";
import "./globals.css";

const siteUrl = getSiteUrl();

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "TalkCV — A resume website that talks back",
    template: "%s | TalkCV",
  },
  icons: {
    icon: "/favicon.svg",
  },
  description: "Turn any resume into a bilingual, Agent-native interactive portfolio website.",
  alternates: {
    canonical: "/",
    types: {
      "text/plain": "/llms.txt",
    },
  },
  openGraph: {
    type: "website",
    siteName: "TalkCV",
    title: "TalkCV — Interactive AI Resume",
    description: "Turn any resume into a bilingual, Agent-native interactive portfolio website.",
  },
  twitter: {
    card: "summary_large_image",
    title: "TalkCV — Interactive AI Resume",
    description: "Turn any resume into a bilingual, Agent-native interactive portfolio website.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme={profile.theme} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
