import handler from "vinext/server/app-router-entry";
import { handleChatRequest, type ChatEnv } from "./chat";
import { handleGenerateRequest } from "./generate";
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
    if (url.pathname === "/api/chat") {
      return handleChatRequest(request, env);
    }
    if (url.pathname === "/api/generate") {
      return handleGenerateRequest(request, env);
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
    return handler.fetch(request);
  },
};

export default worker;
