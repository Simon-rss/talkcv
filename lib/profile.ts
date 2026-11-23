import rawProfile from "../data/profile.json";
import { isValidTheme, type PortfolioProfile, type ProjectItem, type ThemeId } from "./schema";

export const profile: PortfolioProfile = {
  ...(rawProfile as PortfolioProfile),
  theme: isValidTheme((rawProfile as { theme?: unknown }).theme)
    ? ((rawProfile as { theme: ThemeId }).theme)
    : "editorial",
};

export function getProjectBySlug(slug: string): ProjectItem | undefined {
  return profile.projects.find((project) => project.slug === slug);
}

export function getSiteUrl(): string {
  return (profile.siteUrl || "https://example.com").replace(/\/+$/, "");
}
