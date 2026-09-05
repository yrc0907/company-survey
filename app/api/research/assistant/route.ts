import { z } from "zod";

import { errorResponse, json } from "@/lib/api/http";
import { requireAuthenticatedActor } from "@/lib/auth/session";
import { getPlatformRepository } from "@/lib/repositories/platform/platform-repository-factory";
import { AuthorizationService } from "@/lib/services/platform/authorization-service";
import { getResearchRepository } from "@/lib/providers/repository-factory";
import { getAiConfigurationStatus } from "@/lib/services/ai-configuration";
import { KnowledgeAgentService } from "@/lib/services/agents/knowledge-agent-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** AI 请求只构造受限上下文；模型 Provider 不能读取文件、全库快照或任意 URL。 */
const assistantSchema = z.object({
  reportId: z.string().min(1),
  projectId: z.string().min(1).max(128),
  scope: z.enum(["current_file", "current_project"]),
  question: z.string().min(1).max(1_000),
  selectedText: z.string().max(8_000).optional(),
  selectedSectionId: z.string().optional(),
});

/** 返回 Multi-Agent 协作后的引用型回答；必须登录，且 AI 永远不会直接保存报告。 */
export async function POST(request: Request) {
  try {
    const actor = await requireAuthenticatedActor();
    const input = assistantSchema.parse(await request.json());
    await new AuthorizationService(getPlatformRepository()).assertProjectAction(actor, input.projectId, "read_published");
    const project = await getPlatformRepository().getPublicProject(input.projectId);
    if (!project || project.assistantReportId !== input.reportId) return json({ error: "项目与报告 Scope 不匹配", code: "SCOPE_MISMATCH" }, { status: 403 });
    const configuration = getAiConfigurationStatus();
    const workflow = await new KnowledgeAgentService(getResearchRepository()).run(input, { actorUserId: actor.userId, projectId: input.projectId, scope: input.scope });
    return json({
      status: workflow.completion.status === "completed" ? "context_ready" : "degraded",
      reason: workflow.completion.reason,
      configuration,
      context: workflow.context,
      answer: workflow.answer,
      workflow: workflow.workflow,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
