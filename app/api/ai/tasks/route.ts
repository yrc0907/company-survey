import { z } from "zod";

import { errorResponse, json } from "@/lib/api/http";
import { authErrorResponse } from "@/lib/auth/api-response";
import { requireAuthenticatedActor } from "@/lib/auth/session";
import { AuthenticationRequiredError } from "@/lib/domain/platform";
import { getResearchRepository } from "@/lib/providers/repository-factory";
import { getKnowledgeTaskRepository } from "@/lib/repositories/agents/repository-factory";
import { KnowledgeTaskService } from "@/lib/services/agents/knowledge-task-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const taskSchema = z.object({ reportId: z.string().min(1).max(200), question: z.string().trim().min(1).max(1_000), selectedText: z.string().max(8_000).optional(), selectedSectionId: z.string().max(200).optional() }).strict();

/** 创建并执行持久化知识任务；任务结果仍只进入草稿建议，不直接写正式报告。 */
export async function POST(request: Request) {
  try {
    const actor = await requireAuthenticatedActor();
    const input = taskSchema.parse(await request.json());
    const task = await new KnowledgeTaskService(getKnowledgeTaskRepository(), getResearchRepository()).createAndRun(input, actor.userId);
    return json({ task }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) return authErrorResponse(error);
    return errorResponse(error);
  }
}

/** 列出当前用户的任务；不接受客户端 owner ID。 */
export async function GET(request: Request) {
  try {
    const actor = await requireAuthenticatedActor();
    const reportId = new URL(request.url).searchParams.get("reportId") ?? undefined;
    const tasks = await new KnowledgeTaskService(getKnowledgeTaskRepository(), getResearchRepository()).list(actor.userId, reportId);
    return json({ tasks }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) return authErrorResponse(error);
    return errorResponse(error);
  }
}
