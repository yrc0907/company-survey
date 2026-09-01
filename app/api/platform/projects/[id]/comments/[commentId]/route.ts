import { authErrorResponse } from "@/lib/auth/api-response";
import { requireAuthenticatedActor } from "@/lib/auth/session";
import { assertTrustedJsonRequest } from "@/lib/auth/request-security";
import { json } from "@/lib/api/http";
import { collaborationErrorResponse, ProjectCommentService } from "@/lib/services/collaboration";
import { getCollaborationRepository } from "@/lib/repositories/collaboration";
import { getPlatformRepository } from "@/lib/repositories/platform/platform-repository-factory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 作者本人或项目维护者软删除评论；project id 与 comment id 必须同时匹配。 */
export async function DELETE(request: Request, context: { params: { id: string; commentId: string } }) {
  try {
    assertTrustedJsonRequest(request);
    const actor = await requireAuthenticatedActor();
    const comment = await new ProjectCommentService(getCollaborationRepository(), getPlatformRepository()).remove(context.params.commentId, actor, context.params.id);
    return json({ comment, source: "postgres" }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return collaborationErrorResponse(error) ?? authErrorResponse(error);
  }
}
