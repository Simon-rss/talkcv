import type { Metadata } from "next";
import { PublishedProfileClient } from "./published-client";

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
  return <PublishedProfileClient slug={slug} />;
}
