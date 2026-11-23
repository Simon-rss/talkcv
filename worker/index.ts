import handler from "vinext/server/app-router-entry";
import {
  handleLogoutRequest,
  handleMeRequest,
  handleSendCodeRequest,
  handleVerifyCodeRequest,
} from "./auth";
import { handleChatRequest, type ChatEnv } from "./chat";
import { handleGenerateRequest } from "./generate";
import { handleGetProfileRequest, handlePublishRequest, loadStoredRecord } from "./publish";
import {
  buildLlmsTxtResponse,
  buildResumeJsonResponse,
  buildRobotsResponse,
  buildSitemapResponse,
} from "./site-meta";

interface WorkerEnv extends ChatEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

const worker = {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
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
    if (url.pathname === "/api/chat") {
      return handleChatRequest(request, env);
    }
    if (url.pathname === "/api/generate") {
      return handleGenerateRequest(request, env);
    }
    if (url.pathname === "/api/publish") {
      return handlePublishRequest(request, env);
    }
    if (url.pathname.startsWith("/api/profiles/")) {
      const slug = decodeURIComponent(url.pathname.slice("/api/profiles/".length));
      return handleGetProfileRequest(slug, env);
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
    if (url.pathname.startsWith("/u/") && request.method === "GET") {
      const slug = decodeURIComponent(url.pathname.slice("/u/".length).split("/")[0] || "");
      const record = slug ? await loadStoredRecord(slug, env) : null;
      const rendered = await handler.fetch(request);
      if (!record) {
        return new Response(rendered.body, {
          status: 404,
          headers: rendered.headers,
        });
      }
      const expTs = Date.parse(record.expiresAt);
      if (Number.isFinite(expTs) && Date.now() > expTs) {
        return new Response(rendered.body, {
          status: 410,
          headers: rendered.headers,
        });
      }
      return rendered;
    }
    return handler.fetch(request);
  },
};

export default worker;
