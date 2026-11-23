import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getProjectBySlug, getSiteUrl, profile } from "../../../lib/profile";
import { CaseStudyPage } from "../../portfolio-client";

export function generateStaticParams() {
  return profile.projects.map((project) => ({ slug: project.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const project = getProjectBySlug(slug);
  if (!project) return { title: "Not Found" };

  const siteUrl = getSiteUrl();
  return {
    title: project.title.en,
    description: project.summary.en,
    alternates: { canonical: `/projects/${project.slug}` },
    openGraph: {
      type: "article",
      url: `${siteUrl}/projects/${project.slug}`,
      title: `${project.title.en} | ${profile.basics.name.en}`,
      description: project.summary.en,
    },
  };
}

export default async function ProjectCasePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const project = getProjectBySlug(slug);
  if (!project) notFound();

  return <CaseStudyPage project={project} />;
}
