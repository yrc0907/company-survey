import { errorResponse, json } from "@/lib/api/http";
import { authErrorResponse } from "@/lib/auth/api-response";
import { requireAuthenticatedActor } from "@/lib/auth/session";
import { AuthenticationRequiredError } from "@/lib/domain/platform";
import { getResearchRepository } from "@/lib/providers/repository-factory";
import { getKnowledgeTaskRepository } from "@/lib/repositories/agents/repository-factory";
import { KnowledgeTaskService } from "@/lib/services/agents/knowledge-task-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 返回当前用户任务和追加式 Agent 事件；任务 ID 不能越权读取。 */
export async function GET(_request: Request, context: { params: { id: string } }) {
  try {
    const actor = await requireAuthenticatedActor();
    const result = await new KnowledgeTaskService(getKnowledgeTaskRepository(), getResearchRepository()).get(context.params.id, actor.userId);
    if (!result) return json({ error: "任务不存在", code: "NOT_FOUND" }, { status: 404 });
    return json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) return authErrorResponse(error);
    return errorResponse(error);
  }
}

/** 取消尚未开始或已暂停的任务；运行中的任务不能伪装成已取消。 */
export async function DELETE(_request: Request, context: { params: { id: string } }) {
  try {
    const actor = await requireAuthenticatedActor();
    const task = await new KnowledgeTaskService(getKnowledgeTaskRepository(), getResearchRepository()).cancel(context.params.id, actor.userId);
    if (!task) return json({ error: "任务不存在", code: "NOT_FOUND" }, { status: 404 });
    return json({ task }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) return authErrorResponse(error);
    return errorResponse(error);
  }
}

/** 执行、暂停或恢复任务；状态转换仍由服务端校验，客户端不能直接写状态。 */
export async function PATCH(request: Request, context: { params: { id: string } }) {
  try {
    const actor = await requireAuthenticatedActor();
    const body = await request.json() as { action?: unknown };
    const service = new KnowledgeTaskService(getKnowledgeTaskRepository(), getResearchRepository());
    const task = body.action === "pause"
      ? await service.pause(context.params.id, actor.userId)
      : body.action === "resume"
        ? await service.resume(context.params.id, actor.userId)
        : body.action === "execute"
          ? await service.execute(context.params.id, actor.userId)
          : null;
    if (!task) return json({ error: "任务不存在或当前状态不可执行", code: "NOT_FOUND" }, { status: 404 });
    return json({ task }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) return authErrorResponse(error);
    return errorResponse(error);
  }
}
