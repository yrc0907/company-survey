import { z } from "zod";

import { authErrorResponse } from "@/lib/auth/api-response";
import { getAuthenticatedActor, requireAuthenticatedActor } from "@/lib/auth/session";
import { assertTrustedJsonRequest } from "@/lib/auth/request-security";
import { json } from "@/lib/api/http";
import { collaborationErrorResponse, ProjectCommentService } from "@/lib/services/collaboration";
import { getCollaborationRepository } from "@/lib/repositories/collaboration";
import { getPlatformRepository } from "@/lib/repositories/platform/platform-repository-factory";
import { readIdempotencyKey } from "@/lib/services/collaboration/idempotency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  parentId: z.string().trim().min(1).max(128).nullable().optional(),
  body: z.string().trim().min(1).max(10000),
}).strict();

function service(): ProjectCommentService {
  return new ProjectCommentService(getCollaborationRepository(), getPlatformRepository());
}

/** 公开项目评论匿名可读；正文和作者资料来自 PostgreSQL，不使用演示用户。 */
export async function GET(request: Request, context: { params: { id: string } }) {
  try {
    const actor = await getAuthenticatedActor();
    const comments = await service().list(context.params.id, actor);
    return json({ comments, source: "postgres" }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return collaborationErrorResponse(error) ?? authErrorResponse(error);
  }
}

/** 登录用户创建项目评论；Idempotency-Key 可避免网络重试生成重复评论。 */
export async function POST(request: Request, context: { params: { id: string } }) {
  try {
    assertTrustedJsonRequest(request);
    const actor = await requireAuthenticatedActor();
    const input = createSchema.parse(await request.json());
    const comment = await service().create({ projectId: context.params.id, parentId: input.parentId ?? null, body: input.body, idempotencyKey: readIdempotencyKey(request) }, actor);
    return json({ comment, source: "postgres" }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return collaborationErrorResponse(error) ?? authErrorResponse(error);
  }
}
