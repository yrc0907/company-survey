import { z } from "zod";

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
const anonymousRequests = new Map<string, number[]>();

/** 单实例公开 AI 的保守限流；达到规模后迁移到 Redis，不能把模型 Key 暴露给浏览器。 */
function assertAnonymousBudget(request: Request): void {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = request.headers.get("x-real-ip")?.trim() || forwarded || "unknown";
  const now = Date.now();
  const recent = (anonymousRequests.get(address) ?? []).filter((stamp) => now - stamp < ANONYMOUS_WINDOW_MS);
  if (recent.length >= ANONYMOUS_MAX_REQUESTS) throw new Error("公开 AI 体验次数已达到当前时段上限，请稍后再试");
  recent.push(now);
  anonymousRequests.set(address, recent);
  while (anonymousRequests.size > 10_000) {
    const oldest = anonymousRequests.keys().next().value as string | undefined;
    if (!oldest) break;
    anonymousRequests.delete(oldest);
  }
}

/** 返回引用型 AI 回答；未配置或无证据时明确降级，且 AI 永远不会直接保存报告。 */
export async function POST(request: Request) {
  try {
    assertAnonymousBudget(request);
    const input = assistantSchema.parse(await request.json());
    const configuration = getAiConfigurationStatus();
    const context = await new ContextProjectionService(getResearchRepository()).project(input);
    const completion = await getModelProvider().complete(context);
    return json({
      status: completion.status === "completed" ? "context_ready" : "degraded",
      reason: completion.reason,
      configuration,
      context,
      answer: completion.answer,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message.includes("公开 AI 体验次数")) return json({ error: error.message, code: "RATE_LIMITED" }, { status: 429 });
    return errorResponse(error);
  }
}
