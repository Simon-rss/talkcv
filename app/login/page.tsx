import type { Metadata } from "next";
import { safeLoginNext } from "../../lib/login";
import { LoginClient } from "./login-client";

export const metadata: Metadata = { title: "登录 · Sign in", robots: { index: false, follow: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { lang, next, ref } = await searchParams;
  return <LoginClient initialLang={lang === "en" ? "en" : "zh"} next={safeLoginNext(next)} referral={typeof ref === "string" ? ref : null} />;
}
