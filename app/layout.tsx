import type { Metadata } from "next";
import { getSiteUrl, profile } from "../lib/profile";
import "./globals.css";

const siteUrl = getSiteUrl();

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: `${profile.basics.name.en} | ${profile.basics.role.en}`,
    template: `%s | ${profile.basics.name.en}`,
  },
  description: `${profile.basics.headline.en} ${profile.basics.intro.en}`,
  alternates: {
    canonical: "/",
    types: {
      "text/plain": "/llms.txt",
    },
  },
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: `${profile.basics.name.en} — Portfolio`,
    title: `${profile.basics.name.en} | ${profile.basics.role.en}`,
    description: profile.basics.headline.en,
  },
  twitter: {
    card: "summary_large_image",
    title: `${profile.basics.name.en} | ${profile.basics.role.en}`,
    description: profile.basics.headline.en,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme={profile.theme} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
