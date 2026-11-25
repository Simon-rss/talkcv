import { normalizeSlug } from "../lib/schema";
import { getSiteInsights, recordVisit } from "./insights";
import { handleLeads } from "./leads";
import { handleOutreach } from "./outreach";
import { siteUnlocked, unlockSite } from "./site-access";
import handler from "vinext/server/app-router-entry";
import {
  handleLogoutRequest,
  handleMeRequest,
  handleSendCodeRequest,
  handleVerifyCodeRequest,
} from "./auth";
import {
  billingAvailability,
  getUserPlan,
  handleBillingCheckoutRequest,
  handleBillingPortalRequest,
  handleCreateRedeemCodesRequest,
  handleCreemWebhookRequest,
  handleRedeemCodeRequest,
  type BillingEnv,
} from "./billing";
import {
  handleAdminCreateCodeRequest,
  handleAdminCreateDiscountRequest,
  handleAdminOverviewRequest,
  type AdminEnv,
} from "./admin";
import { handleChatRequest, type ChatEnv } from "./chat";
import { handleGenerateCustomPageRequest } from "./custom-page";
import { handleAiEditRequest } from "./edit";
import { handleOgImageRequest } from "./og";
import { handleParseResumeImageRequest } from "./parse-image";
import { recordSiteTraffic, shouldTrackTraffic } from "./traffic";
import { handleGenerateRequest } from "./generate";
import { handleDeleteProfileRequest, handleGetProfileRequest, handlePublishRequest, loadStoredRecord } from "./publish";
import {
  buildLlmsTxtResponse,
  buildResumeJsonResponse,
  buildRobotsResponse,
  buildSitemapResponse,
} from "./site-meta";

interface WorkerEnv extends ChatEnv, BillingEnv, AdminEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

const worker = {
  async fetch(request: Request, env: WorkerEnv, ctx?: { waitUntil(task: Promise<unknown>): void }): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/auth/send-code") {
      return handleSendCodeRequest(request, env);
    }
    if (url.pathname === "/api/auth/verify") {
      return handleVerifyCodeRequest(request, env);
    }
    if (url.pathname === "/api/auth/me") {
      return handleMeRequest(request, env);
    }
    if (url.pathname === "/api/auth/logout") {
      return handleLogoutRequest(request);
    }
    if (url.pathname === "/api/billing/plans" && request.method === "GET") {
      return Response.json(billingAvailability(env));
    }
    if (url.pathname === "/api/billing/checkout") {
      return handleBillingCheckoutRequest(request, env);
    }
    if (url.pathname === "/api/billing/portal") {
      return handleBillingPortalRequest(request, env);
    }
    if (url.pathname === "/api/billing/webhook") {
      return handleCreemWebhookRequest(request, env);
    }
    if (url.pathname === "/api/billing/redeem") {
      return handleRedeemCodeRequest(request, env);
    }
    if (url.pathname === "/api/billing/admin/codes") {
      return handleCreateRedeemCodesRequest(request, env);
    }
    if (url.pathname === "/api/admin/overview") {
      return handleAdminOverviewRequest(request, env);
    }
    if (url.pathname === "/api/admin/codes") {
      return handleAdminCreateCodeRequest(request, env);
    }
    if (url.pathname === "/api/admin/discounts") {
      return handleAdminCreateDiscountRequest(request, env);
    }
    if (url.pathname === "/api/chat") {
      return handleChatRequest(request, env);
    }
    if (url.pathname === "/api/generate") {
      return handleGenerateRequest(request, env);
    }
    if (url.pathname === "/api/generate-custom") {
      return handleGenerateCustomPageRequest(request, env);
    }
    if (url.pathname === "/api/parse-resume-image") {
      return handleParseResumeImageRequest(request, env);
    }
    if (url.pathname === "/api/og") {
      return handleOgImageRequest(request, env);
    }
    if (url.pathname === "/api/edit") {
      return handleAiEditRequest(request, env);
    }
    if (url.pathname === "/api/outreach") return handleOutreach(request, env);
    if (url.pathname === "/api/publish") {
      return handlePublishRequest(request, env);
    }
    const leads = /^\/api\/profiles\/([a-z0-9-]+)\/leads$/.exec(url.pathname);
    if (leads) return handleLeads(request, leads[1], env, ctx);
    const insights = /^\/api\/profiles\/([a-z0-9-]+)\/insights$/.exec(url.pathname);
    if (insights && request.method === "GET") return getSiteInsights(request, insights[1], env);
    const unlock = /^\/api\/profiles\/([a-z0-9-]+)\/unlock$/.exec(url.pathname);
    if (unlock && request.method === "POST") return unlockSite(request, unlock[1], env);
    if (/^\/api\/profiles\/[^/]+$/.test(url.pathname)) {
      const slug = decodeURIComponent(url.pathname.slice("/api/profiles/".length));
      if (request.method === "DELETE") return handleDeleteProfileRequest(request, slug, env);
      if (request.method !== "GET") return new Response(null, { status: 405 });
      return handleGetProfileRequest(request, slug, env);
    }
    if (url.pathname === "/sitemap.xml") {
      return buildSitemapResponse();
    }
    if (url.pathname === "/robots.txt") {
      return buildRobotsResponse();
    }
    if (url.pathname === "/llms.txt") {
      return buildLlmsTxtResponse();
    }
    if (url.pathname === "/resume.json") {
      return buildResumeJsonResponse();
    }
    if (url.pathname.startsWith("/u/") && (request.method === "GET" || request.method === "HEAD")) {
      const slug = normalizeSlug(decodeURIComponent(url.pathname.slice("/u/".length).split("/")[0] || ""));
      const record = slug ? await loadStoredRecord(slug, env) : null;
      const ownerPlan = record?.ownerEmail ? await getUserPlan(record.ownerEmail, env) : null;
      const hasPermanentHosting = Boolean(ownerPlan?.isPro && !ownerPlan?.isTrial);
      const expired = record && !hasPermanentHosting && Date.now() > Date.parse(record.expiresAt);
      const hidden = Boolean(record?.noindex || record?.passcode);
      const locked = record && !expired && !await siteUnlocked(request, slug, record.passcode);
      const requestHeaders = new Headers(request.headers);
      requestHeaders.set("x-talkcv-robots", hidden ? "noindex" : "index");
      requestHeaders.set("x-talkcv-site-state", !record ? "not_found" : expired ? "expired" : locked ? "locked" : "loading");
      if (record && !expired && !locked && !record.passcode) {
        const ogName = record.profile.basics.name.zh || record.profile.basics.name.en || slug;
        const ogRole = record.profile.basics.role.zh || record.profile.basics.role.en || "";
        const ogHeadline = record.profile.basics.headline.zh || record.profile.basics.headline.en || "";
        requestHeaders.set("x-talkcv-og-name", encodeURIComponent(ogName.slice(0, 80)));
        requestHeaders.set("x-talkcv-og-role", encodeURIComponent(ogRole.slice(0, 120)));
        requestHeaders.set("x-talkcv-og-headline", encodeURIComponent(ogHeadline.slice(0, 200)));
      }
      const rendered = await handler.fetch(new Request(request, { headers: requestHeaders }));
      const headers = new Headers(rendered.headers);
      headers.set("cache-control", "private, no-store");
      if (record && !locked && !expired && rendered.ok && request.method === "GET"
        && headers.get("content-type")?.includes("text/html") && !request.headers.has("next-router-prefetch")
        && request.headers.get("purpose") !== "prefetch") {
        await recordVisit(slug, record, env);
      }
      if (hidden) headers.set("x-robots-tag", "noindex, nofollow");
      const finalRes = new Response(rendered.body, { status: !record ? 404 : expired ? 410 : rendered.status, headers });
      if (shouldTrackTraffic(request, url.pathname, finalRes)) {
        const task = recordSiteTraffic(request, url.pathname, env).catch(() => {});
        if (ctx?.waitUntil) ctx.waitUntil(task);
      }
      return finalRes;
    }
    const response = await handler.fetch(request);
    if (shouldTrackTraffic(request, url.pathname, response)) {
      const task = recordSiteTraffic(request, url.pathname, env).catch(() => {});
      if (ctx?.waitUntil) ctx.waitUntil(task);
    }
    return response;
  },
};

export default worker;
