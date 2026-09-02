import { z } from "zod";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { errorResponse, json } from "@/lib/api/http";
import { getResearchRepository } from "@/lib/providers/repository-factory";
import { getModelProvider } from "@/lib/providers/model-provider";
import { getAiConfigurationStatus } from "@/lib/services/ai-configuration";
import { ContextProjectionService } from "@/lib/services/context-projection-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** AI 请求只构造受限上下文；模型 Provider 不能读取文件、全库快照或任意 URL。 */
const assistantSchema = z.object({
  reportId: z.string().min(1),
  question: z.string().min(1).max(1_000),
  selectedText: z.string().max(8_000).optional(),
  selectedSectionId: z.string().optional(),
});

const ANONYMOUS_WINDOW_MS = 60 * 60 * 1_000;
const ANONYMOUS_MAX_REQUESTS = 20;
const ANONYMOUS_AI_COOKIE = "research_ai_visitor";
const developmentRateLimitSecret = randomUUID();
const anonymousRequests = new Map<string, number[]>();

function rateLimitSecret(): string {
  // 生产必须使用独立密钥；开发环境才允许回退到 NEXTAUTH_SECRET，不能把签名密钥写进客户端。
  const secret = process.env.ANONYMOUS_AI_RATE_LIMIT_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") throw new Error("匿名 AI 限流密钥未配置");
  // 本地仅用于防止误测时无限请求；生产永远不会使用这个进程内回退值。
  return developmentRateLimitSecret;
}

function signVisitorId(visitorId: string): string {
  return createHmac("sha256", rateLimitSecret()).update(visitorId, "utf8").digest("base64url");
}

function parseCookie(request: Request, name: string): string | null {
  const pair = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : null;
}

/** 只接受服务端签名的访客票据；无票据时生成随机 ID，原始 ID 不进入日志或响应正文。 */
function anonymousVisitorKey(request: Request): { key: string; setCookie: string | null } {
  const candidate = parseCookie(request, ANONYMOUS_AI_COOKIE);
  if (candidate) {
    const [visitorId, signature] = candidate.split(".");
    if (visitorId && signature) {
      const expected = signVisitorId(visitorId);
      const left = Buffer.from(signature);
      const right = Buffer.from(expected);
      if (left.length === right.length && timingSafeEqual(left, right)) return { key: `visitor:${visitorId}`, setCookie: null };
    }
  }
  const visitorId = randomUUID();
  const value = `${visitorId}.${signVisitorId(visitorId)}`;
  return { key: `visitor:${visitorId}`, setCookie: `${ANONYMOUS_AI_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}` };
}

/** 单实例公开 AI 的保守限流；签名 Cookie 防止仅修改客户端 ID 绕过，达到规模后迁移 Redis。 */
function assertAnonymousBudget(request: Request): string | null {
  const visitor = anonymousVisitorKey(request);
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = request.headers.get("x-real-ip")?.trim() || forwarded || "unknown";
  const now = Date.now();
  const recent = (anonymousRequests.get(visitor.key) ?? []).filter((stamp) => now - stamp < ANONYMOUS_WINDOW_MS);
  if (recent.length >= ANONYMOUS_MAX_REQUESTS) throw new Error("公开 AI 体验次数已达到当前时段上限，请稍后再试");
  recent.push(now);
  anonymousRequests.set(visitor.key, recent);
  // 同时绑定来源 IP 的粗粒度桶，防止无 Cookie 的批量请求耗尽服务；IP 不进入客户端。
  const ipRecent = (anonymousRequests.get(`ip:${address}`) ?? []).filter((stamp) => now - stamp < ANONYMOUS_WINDOW_MS);
  if (ipRecent.length >= ANONYMOUS_MAX_REQUESTS * 5) throw new Error("公开 AI 请求过于频繁，请稍后再试");
  ipRecent.push(now);
  anonymousRequests.set(`ip:${address}`, ipRecent);
  while (anonymousRequests.size > 10_000) {
    const oldest = anonymousRequests.keys().next().value as string | undefined;
    if (!oldest) break;
    anonymousRequests.delete(oldest);
  }
  return visitor.setCookie;
}

/** 返回引用型 AI 回答；未配置或无证据时明确降级，且 AI 永远不会直接保存报告。 */
export async function POST(request: Request) {
  try {
    const setCookie = assertAnonymousBudget(request);
    const input = assistantSchema.parse(await request.json());
    const configuration = getAiConfigurationStatus();
    const context = await new ContextProjectionService(getResearchRepository()).project(input);
    const completion = await getModelProvider().complete(context);
    const response = json({
      status: completion.status === "completed" ? "context_ready" : "degraded",
      reason: completion.reason,
      configuration,
      context,
      answer: completion.answer,
    }, { headers: { "cache-control": "no-store" } });
    if (setCookie) response.headers.append("set-cookie", setCookie);
    return response;
  } catch (error) {
    if (error instanceof Error && error.message.includes("公开 AI 体验次数")) return json({ error: error.message, code: "RATE_LIMITED" }, { status: 429 });
    return errorResponse(error);
  }
}
