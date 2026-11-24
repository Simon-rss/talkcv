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
  const label = `${slug} · TalkCV`;
  const desc = `Interactive AI resume & portfolio for @${slug}, hosted on TalkCV.`;
  return {
    title: { absolute: label },
    description: desc,
    ...((await headers()).get("x-talkcv-robots") === "noindex" && { robots: { index: false, follow: false } }),
    alternates: {
      canonical: `/u/${slug}`,
    },
    openGraph: {
      type: "profile",
      title: label,
      description: desc,
    },
    twitter: {
      title: label,
      description: desc,
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
