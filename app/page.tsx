import type { Metadata } from "next";
import { getSiteUrl, profile } from "../lib/profile";
import { PortfolioHome } from "./portfolio-client";

export const metadata: Metadata = {
  title: {
    absolute: `${profile.basics.name.en} | ${profile.basics.role.en}`,
  },
  description: `${profile.basics.headline.en} ${profile.basics.intro.en}`,
  openGraph: {
    title: `${profile.basics.name.en} | ${profile.basics.role.en}`,
    description: profile.basics.headline.en,
  },
  twitter: {
    title: `${profile.basics.name.en} | ${profile.basics.role.en}`,
    description: profile.basics.headline.en,
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
