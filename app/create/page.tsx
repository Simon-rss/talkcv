import type { Metadata } from "next";
import { CreateStudioClient } from "./create-client";

export const metadata: Metadata = {
  title: "Create Your TalkCV",
  description:
    "Paste your resume, pick a theme, and generate a bilingual Agent-native portfolio config in seconds.",
};

export default async function CreatePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { lang, plan, interval } = await searchParams;
  return <CreateStudioClient initialLang={lang === "en" ? "en" : "zh"} checkout={
    (plan === "pro" || plan === "max") && (interval === "month" || interval === "year") ? { tier: plan, interval } : undefined
  } />;
}
