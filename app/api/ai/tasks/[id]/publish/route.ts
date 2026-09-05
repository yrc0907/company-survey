import { randomUUID } from "node:crypto";

import { z } from "zod";

import { errorResponse } from "@/lib/api/http";
import { authErrorResponse } from "@/lib/auth/api-response";
import { assertTrustedJsonRequest } from "@/lib/auth/request-security";
import { requireAuthenticatedActor } from "@/lib/auth/session";
import { AuthenticationRequiredError } from "@/lib/domain/platform";
import { getCollaborationRepository } from "@/lib/repositories/collaboration";
import { getKnowledgeTaskRepository } from "@/lib/repositories/agents/repository-factory";
import { getPlatformRepository } from "@/lib/repositories/platform/platform-repository-factory";
import { CollaborationService } from "@/lib/services/collaboration/collaboration-service";
import { readIdempotencyKey } from "@/lib/services/collaboration/idempotency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ projectId: z.string().trim().min(1).max(128), sourceBranchId: z.string().trim().min(1).max(128), targetBranchId: z.string().trim().min(1).max(128), title: z.string().trim().min(1).max(200), description: z.string().trim().max(5_000).optional() }).strict();

/** 将 Publishing Agent 的建议提交为真实 MR；必须由任务所有者显式调用，且不自动审核或合并。 */
export async function POST(request: Request, context: { params: { id: string } }) {
  try {
    assertTrustedJsonRequest(request);
    const actor = await requireAuthenticatedActor();
    const input = schema.parse(await request.json());
    const taskRepository = getKnowledgeTaskRepository();
    const task = await taskRepository.getTask(context.params.id, actor.userId);
    if (!task) return new Response(JSON.stringify({ error: "任务不存在", code: "NOT_FOUND" }), { status: 404, headers: { "content-type": "application/json" } });
    if (task.status !== "completed" || !task.selectedAgents.includes("publishing")) return new Response(JSON.stringify({ error: "任务尚未生成可发布建议", code: "PUBLISHING_NOT_READY" }), { status: 409, headers: { "content-type": "application/json" } });
    const taskInput = task.state.input as Record<string, unknown> | undefined;
    if (taskInput?.projectId !== input.projectId) return new Response(JSON.stringify({ error: "项目与任务 Scope 不匹配", code: "SCOPE_MISMATCH" }), { status: 403, headers: { "content-type": "application/json" } });
    const mergeRequest = await new CollaborationService(getCollaborationRepository(), getPlatformRepository()).createMergeRequest({ ...input, idempotencyKey: readIdempotencyKey(request) }, actor);
    const updated = { ...task, state: { ...task.state, publication: { mergeRequestId: mergeRequest.id, status: "open", confirmedByUserId: actor.userId } }, updatedAt: new Date().toISOString() };
    await taskRepository.updateTask(updated);
    await taskRepository.appendEvent({ id: randomUUID(), taskId: task.id, node: "human_approval", status: "completed", payload: { action: "create_merge_request", mergeRequestId: mergeRequest.id, autoMerge: false }, createdAt: new Date().toISOString() });
    return new Response(JSON.stringify({ mergeRequest, task: updated }), { status: 201, headers: { "cache-control": "no-store", "content-type": "application/json" } });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) return authErrorResponse(error);
    return errorResponse(error);
  }
}
