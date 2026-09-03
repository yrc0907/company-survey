import { z } from "zod";

import { errorResponse, json } from "@/lib/api/http";
import { getAuthenticatedActor } from "@/lib/auth/session";
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

/** 返回引用型 AI 回答；必须登录，未配置或无证据时明确降级，且 AI 永远不会直接保存报告。 */
export async function POST(request: Request) {
  try {
    if (!await getAuthenticatedActor()) return json({ error: "AI 助手暂仅对内测用户开放，请先登录", code: "AUTH_REQUIRED" }, { status: 401 });
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
    return errorResponse(error);
  }
}
