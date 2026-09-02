import { z } from "zod";

import { json } from "@/lib/api/http";
import { authErrorResponse } from "@/lib/auth/api-response";
import { assertTrustedJsonRequest } from "@/lib/auth/request-security";
import { getAuthenticatedActor, requireAuthenticatedActor } from "@/lib/auth/session";
import { getCollaborationRepository } from "@/lib/repositories/collaboration";
import { getPlatformRepository } from "@/lib/repositories/platform/platform-repository-factory";
import { collaborationErrorResponse, ProjectCommentService } from "@/lib/services/collaboration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ liked: z.boolean() }).strict();

function service(): ProjectCommentService {
  return new ProjectCommentService(getCollaborationRepository(), getPlatformRepository());
}

/** 评论点赞状态可匿名读取；总数来自 PostgreSQL active 关系，不接受客户端计数。 */
export async function GET(_request: Request, context: { params: { id: string; commentId: string } }) {
  try {
    const actor = await getAuthenticatedActor();
    const state = await service().getLike(context.params.commentId, context.params.id, actor?.userId ?? null);
    return json({ ...state, source: "postgres" }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return collaborationErrorResponse(error) ?? authErrorResponse(error);
  }
}

/** 登录用户幂等设置点赞；身份来自 Session，不能从请求体伪造。 */
export async function POST(request: Request, context: { params: { id: string; commentId: string } }) {
  try {
    assertTrustedJsonRequest(request);
    const actor = await requireAuthenticatedActor();
    const input = bodySchema.parse(await request.json());
    const state = await service().setLike(context.params.commentId, context.params.id, actor, input.liked);
    return json({ ...state, source: "postgres" }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return collaborationErrorResponse(error) ?? authErrorResponse(error);
  }
}

/** DELETE 使用明确取消语义，重复请求保持幂等。 */
export async function DELETE(request: Request, context: { params: { id: string; commentId: string } }) {
  try {
    assertTrustedJsonRequest(request);
    const actor = await requireAuthenticatedActor();
    const state = await service().setLike(context.params.commentId, context.params.id, actor, false);
    return json({ ...state, source: "postgres" }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return collaborationErrorResponse(error) ?? authErrorResponse(error);
  }
}
