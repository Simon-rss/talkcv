import { PublicPage, type PublicPageProps } from "../public-navigation";
import { PublicPlans } from "./public-plans";

export const metadata = { title: "Pricing · 会员定价", alternates: { canonical: "/pricing" } };

export default async function PricingPage({ searchParams }: PublicPageProps) {
  const lang = (await searchParams).lang === "en" ? "en" : "zh";
  return <PublicPage path="/pricing" lang={lang} title={lang === "en" ? "TalkCV plans" : "TalkCV 会员方案"}>
    <PublicPlans lang={lang} />
  </PublicPage>;
}
