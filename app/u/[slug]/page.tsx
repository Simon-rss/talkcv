import type { Metadata } from "next";
import { PublishedProfileClient } from "./published-client";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  return {
    title: `${slug} · TalkCV`,
    description: `Interactive AI resume & portfolio for ${slug}, powered by TalkCV.`,
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
