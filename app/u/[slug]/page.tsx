import { headers } from "next/headers";
import type { Metadata } from "next";
import { PublishedProfileClient } from "./published-client";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const hdrs = await headers();
  const safeDecode = (val: string | null) => {
    if (!val) return "";
    try {
      return decodeURIComponent(val);
    } catch {
      return "";
    }
  };
  const ogName = safeDecode(hdrs.get("x-talkcv-og-name"));
  const ogRole = safeDecode(hdrs.get("x-talkcv-og-role"));
  const ogHeadline = safeDecode(hdrs.get("x-talkcv-og-headline"));
  const label = ogName
    ? ogRole
      ? `${ogName} · ${ogRole} | TalkCV`
      : `${ogName} · 个人交互简历 | TalkCV`
    : `${slug} · TalkCV`;
  const desc = ogHeadline || `Interactive AI resume & portfolio for @${slug}, hosted on TalkCV.`;
  const ogImg = `/api/og?slug=${encodeURIComponent(slug)}`;
  return {
    title: { absolute: label },
    description: desc,
    ...(hdrs.get("x-talkcv-robots") === "noindex" && { robots: { index: false, follow: false } }),
    alternates: {
      canonical: `/u/${slug}`,
    },
    openGraph: {
      type: "profile",
      title: label,
      description: desc,
      images: [ogImg],
    },
    twitter: {
      card: "summary_large_image",
      title: label,
      description: desc,
      images: [ogImg],
    },
  };
}

export default async function PublishedSitePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const state = (await headers()).get("x-talkcv-site-state");
  const initialStatus = state === "locked" || state === "not_found" || state === "expired" ? state : "loading";
  return <PublishedProfileClient key={slug} slug={slug} initialStatus={initialStatus} />;
}
