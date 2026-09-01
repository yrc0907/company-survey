import { randomUUID } from "node:crypto";

import { getAuthenticatedActor } from "@/lib/auth/session";
import { assertTrustedJsonRequest } from "@/lib/auth/request-security";
import { authErrorResponse } from "@/lib/auth/api-response";
import { json } from "@/lib/api/http";
import { PublicProjectService } from "@/lib/services/platform/public-project-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VISITOR_COOKIE = "research_visitor_id";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AUTOMATED_CLIENT_PATTERN = /bot|crawler|spider|slurp|headless|curl|wget|healthcheck|uptime/i;

function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(separator + 1).trim()); } catch { return null; }
  }
  return null;
}

/**
 * 记录公开详情页阅读。POST + 同源校验避免预加载和爬虫把详情 GET 当作阅读；
 * 自动化客户端、健康检查和无效访客 Cookie 不会进入阅读事实表。
 */
export async function POST(request: Request, context: { params: { id: string } }) {
  try {
    assertTrustedJsonRequest(request);
    const userAgent = request.headers.get("user-agent") ?? "";
    if (AUTOMATED_CLIENT_PATTERN.test(userAgent)) return json({ recorded: false, ignored: "automated_client" }, { headers: { "cache-control": "no-store" } });

    const existingVisitorId = cookieValue(request.headers.get("cookie"), VISITOR_COOKIE);
    const visitorId = existingVisitorId && UUID_PATTERN.test(existingVisitorId) ? existingVisitorId : randomUUID();
    const actor = await getAuthenticatedActor();
    const result = await new PublicProjectService().recordView({ projectIdOrSlug: context.params.id, userId: actor?.userId ?? null, visitorId });
    const response = json({ ...result.data, source: result.source }, { headers: { "cache-control": "no-store" } });
    if (!existingVisitorId || !UUID_PATTERN.test(existingVisitorId)) {
      response.cookies.set({ name: VISITOR_COOKIE, value: visitorId, httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
    }
    return response;
  } catch (error) {
    return authErrorResponse(error);
  }
}

