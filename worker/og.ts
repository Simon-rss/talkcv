import { localize, normalizeSlug } from "../lib/schema";
import { type BillingEnv } from "./billing";
import { loadStoredRecord, type PublishEnv } from "./publish";

function escapeXml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncate(text: string, max: number): string {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

const FONT_STACK = "'Noto Sans CJK SC','PingFang SC','Hiragino Sans GB','Noto Sans',sans-serif";

function renderBrandSvg(opts: {
  badge: string;
  title: string;
  subtitle: string;
  headline: string;
  tags: string[];
  metric?: { value: string; label: string };
  footerUrl: string;
  accent?: string;
}): string {
  const accent = opts.accent || "#0071e3";
  const tagsXml = opts.tags
    .slice(0, 4)
    .map((tag, idx) => {
      const x = 80 + idx * 215;
      return `<g transform="translate(${x}, 435)">
        <rect width="198" height="44" rx="22" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.16)" />
        <text x="99" y="28" text-anchor="middle" fill="#e5e7eb" font-size="18" font-weight="600" font-family="${FONT_STACK}">${escapeXml(truncate(tag, 16))}</text>
      </g>`;
    })
    .join("");

  const metricXml = opts.metric
    ? `<g transform="translate(880, 120)">
        <rect width="240" height="150" rx="24" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.15)" />
        <text x="28" y="76" fill="#ffffff" font-size="48" font-weight="800" font-family="${FONT_STACK}">${escapeXml(truncate(opts.metric.value, 10))}</text>
        <text x="28" y="116" fill="#9ca3af" font-size="18" font-weight="500" font-family="${FONT_STACK}">${escapeXml(truncate(opts.metric.label, 18))}</text>
      </g>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0b0d12" />
      <stop offset="55%" stop-color="#141923" />
      <stop offset="100%" stop-color="#0b0d12" />
    </linearGradient>
    <radialGradient id="glow" cx="80%" cy="15%" r="60%">
      <stop offset="0%" stop-color="${escapeXml(accent)}" stop-opacity="0.34" />
      <stop offset="100%" stop-color="${escapeXml(accent)}" stop-opacity="0" />
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)" />
  <rect width="1200" height="630" fill="url(#glow)" />
  <rect x="44" y="44" width="1112" height="542" rx="32" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.1)" />

  <g transform="translate(80, 92)">
    <rect width="260" height="36" rx="18" fill="${escapeXml(accent)}" fill-opacity="0.2" stroke="${escapeXml(accent)}" stroke-opacity="0.55" />
    <text x="18" y="24" fill="#93c5fd" font-size="15" font-weight="700" letter-spacing="0.06em" font-family="${FONT_STACK}">${escapeXml(opts.badge)}</text>
  </g>

  <text x="80" y="205" fill="#ffffff" font-size="56" font-weight="800" font-family="${FONT_STACK}">${escapeXml(truncate(opts.title, 26))}</text>
  <text x="80" y="258" fill="#cbd5e1" font-size="26" font-weight="500" font-family="${FONT_STACK}">${escapeXml(truncate(opts.subtitle, 46))}</text>
  <text x="80" y="330" fill="#94a3b8" font-size="22" font-weight="400" font-family="${FONT_STACK}">${escapeXml(truncate(opts.headline, 62))}</text>

  ${metricXml}
  ${tagsXml}

  <line x1="80" y1="518" x2="1120" y2="518" stroke="rgba(255,255,255,0.12)" />
  <text x="80" y="556" fill="#94a3b8" font-size="20" font-weight="600" font-family="${FONT_STACK}">${escapeXml(opts.footerUrl)}</text>
  <text x="1120" y="556" text-anchor="end" fill="#60a5fa" font-size="18" font-weight="600" font-family="${FONT_STACK}">Interactive AI Résumé · TalkCV</text>
</svg>`;
}

type ResvgConstructor = new (
  svg: string,
  options?: {
    fitTo?: { mode: "width"; value: number };
    font?: { loadSystemFonts?: boolean; defaultFontFamily?: string };
  },
) => { render(): { asPng(): Uint8Array } };

let cachedResvg: ResvgConstructor | null | undefined;

async function getResvg(): Promise<ResvgConstructor | null> {
  if (cachedResvg !== undefined) return cachedResvg;
  try {
    const pkg = "@resvg/" + "resvg-js";
    const mod = (await import(/* @vite-ignore */ pkg)) as { Resvg?: ResvgConstructor };
    cachedResvg = mod.Resvg ?? null;
  } catch {
    cachedResvg = null;
  }
  return cachedResvg;
}

async function svgToOgResponse(svg: string, cacheControl: string): Promise<Response> {
  const Resvg = await getResvg();
  if (Resvg) {
    try {
      const resvg = new Resvg(svg, {
        fitTo: { mode: "width", value: 1200 },
        font: {
          loadSystemFonts: true,
          defaultFontFamily: "Noto Sans CJK SC",
        },
      });
      const png = resvg.render().asPng();
      const body = new Uint8Array(png.byteLength);
      body.set(png);
      return new Response(body, {
        status: 200,
        headers: {
          "content-type": "image/png",
          "cache-control": cacheControl,
        },
      });
    } catch {
      // fall through to SVG if native rasterizer fails
    }
  }
  return new Response(svg, {
    status: 200,
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": cacheControl,
    },
  });
}

export async function handleOgImageRequest(request: Request, env: PublishEnv & BillingEnv): Promise<Response> {
  const url = new URL(request.url);
  const rawSlug = url.searchParams.get("slug")?.trim() || "";
  const slug = rawSlug ? normalizeSlug(rawSlug) : "";

  if (!slug) {
    const svg = renderBrandSvg({
      badge: "TALKCV · AI RÉSUMÉ",
      title: "TalkCV — 会对话的 AI 个人网站",
      subtitle: "把 PDF / Word / 截图简历 30 秒变成交互式作品集",
      headline: "自带可验证引用 AI 助手 · 粘 JD 测匹配度 · 导出带二维码 A4 PDF",
      tags: ["PDF / 截图解析", "AI 面试分身", "JD 匹配报告", "带码 A4 PDF"],
      metric: { value: "30s", label: "简历秒变个人官网" },
      footerUrl: "mytalkcv.com",
    });
    return svgToOgResponse(svg, "public, max-age=3600");
  }

  const record = await loadStoredRecord(slug, env, { includeMedia: false });
  // Expired free sites stay publicly viewable (aiDormant); only missing or passcode-protected sites are redacted.
  const isPrivate = !record || Boolean(record.passcode);

  if (isPrivate) {
    const svg = renderBrandSvg({
      badge: "PROTECTED · TALKCV",
      title: "TalkCV 私密交互式简历",
      subtitle: "该个人站已开启访问保护或口令锁定",
      headline: "访问链接并验证权限后，即可查看完整作品集并与 AI 助手对话",
      tags: ["口令保护", "隐私可控", "AI 问答", "带码 PDF"],
      footerUrl: `mytalkcv.com/u/${slug}`,
    });
    return svgToOgResponse(svg, "private, no-store");
  }

  const p = record.profile;
  const name = localize(p.basics.name, "zh") || localize(p.basics.name, "en") || slug;
  const role = localize(p.basics.role, "zh") || localize(p.basics.role, "en");
  const headline = localize(p.basics.headline, "zh") || localize(p.basics.headline, "en");
  const firstFact = p.projects?.[0]?.facts?.[0];
  const svg = renderBrandSvg({
    badge: "TALKCV · PERSONAL SITE",
    title: name,
    subtitle: role,
    headline,
    tags: p.skills ?? [],
    metric: firstFact ? { value: firstFact.value, label: localize(firstFact.label, "zh") } : undefined,
    footerUrl: `mytalkcv.com/u/${slug}`,
    accent: p.designTokens?.accent || "#0071e3",
  });

  return svgToOgResponse(svg, "public, max-age=600");
}
