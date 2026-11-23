import { getSiteUrl, profile } from "../lib/profile";

const CACHE_HEADERS = {
  "cache-control": "public, max-age=3600",
};

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function buildSitemapResponse(): Response {
  const base = getSiteUrl();
  const urls = [
    { loc: `${base}/`, priority: "1.0" },
    ...profile.projects.map((project) => ({
      loc: `${base}/projects/${project.slug}`,
      priority: "0.8",
    })),
  ];

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map(
      (entry) =>
        `  <url>\n    <loc>${escapeXml(entry.loc)}</loc>\n    <priority>${entry.priority}</priority>\n  </url>`,
    ),
    "</urlset>",
    "",
  ].join("\n");

  return new Response(xml, {
    status: 200,
    headers: {
      "content-type": "application/xml; charset=utf-8",
      ...CACHE_HEADERS,
    },
  });
}

export function buildRobotsResponse(): Response {
  const base = getSiteUrl();
  const body = ["User-agent: *", "Allow: /", "Disallow: /api/", "", `Sitemap: ${base}/sitemap.xml`, ""].join("\n");

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      ...CACHE_HEADERS,
    },
  });
}

export function buildLlmsTxtResponse(): Response {
  const base = getSiteUrl();
  const lines: string[] = [
    `# ${profile.basics.name.en}`,
    "",
    `> ${profile.basics.role.en}. ${profile.basics.headline.en}`,
    "",
    profile.basics.intro.en,
    "",
    "## Case studies",
    "",
    ...profile.projects.map(
      (p) => `- [${p.title.en}](${base}/projects/${p.slug}): ${p.summary.en}`,
    ),
    "",
    "## Experience",
    "",
    ...profile.experiences.map(
      (e) => `- **${e.period} · ${e.company.en}** — ${e.role.en}: ${e.summary.en}`,
    ),
    "",
    `Education: ${profile.basics.education.en}`,
    "",
    "## Contact",
    "",
    `- Portfolio: ${base}`,
    `- Email: ${profile.basics.email}`,
    ...(profile.basics.github ? [`- GitHub: ${profile.basics.github}`] : []),
    `- Structured Resume JSON: ${base}/resume.json`,
    "",
    "## 中文简介",
    "",
    `${profile.basics.name.zh}，${profile.basics.role.zh}。${profile.basics.headline.zh} ${profile.basics.intro.zh}`,
    "",
  ];

  return new Response(lines.join("\n"), {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      ...CACHE_HEADERS,
    },
  });
}

export function buildResumeJsonResponse(): Response {
  const base = getSiteUrl();
  const resume = {
    $schema: "https://raw.githubusercontent.com/jsonresume/resume-schema/v1.0.0/schema.json",
    basics: {
      name: profile.basics.name.en,
      label: profile.basics.role.en,
      email: profile.basics.email,
      url: base,
      summary: `${profile.basics.headline.en} ${profile.basics.intro.en}`,
      location: { city: profile.basics.location.en },
      profiles: profile.basics.github
        ? [{ network: "GitHub", url: profile.basics.github }]
        : [],
    },
    work: profile.experiences.map((e) => ({
      name: e.company.en,
      position: e.role.en,
      startDate: e.period.split(/[–-]/)[0]?.trim() ?? e.period,
      summary: e.summary.en,
    })),
    education: [{ institution: profile.basics.education.en }],
    skills: [{ name: "Core Skills", keywords: profile.skills }],
    projects: profile.projects.map((p) => ({
      name: p.title.en,
      description: p.summary.en,
      highlights: [p.outcome.en, ...p.facts.map((f) => `${f.value} ${f.label.en}`)],
      keywords: p.tags,
      url: `${base}/projects/${p.slug}`,
      roles: [p.role.en],
    })),
  };

  return new Response(`${JSON.stringify(resume, null, 2)}\n`, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...CACHE_HEADERS,
    },
  });
}
