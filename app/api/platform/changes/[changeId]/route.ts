import { authErrorResponse } from "@/lib/auth/api-response";
import { requireAuthenticatedActor } from "@/lib/auth/session";
import { json } from "@/lib/api/http";
import { collaborationErrorResponse, CollaborationService } from "@/lib/services/collaboration";
import { getCollaborationRepository } from "@/lib/repositories/collaboration";
import { getPlatformRepository } from "@/lib/repositories/platform/platform-repository-factory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 返回 MR、Review 和当前确定性 Diff；访问者必须是提交者或项目维护者。 */
export async function GET(request: Request, context: { params: { changeId: string } }) {
  try { const actor = await requireAuthenticatedActor(); const service = new CollaborationService(getCollaborationRepository(), getPlatformRepository()); const detail = await service.getMergeRequest(context.params.changeId, actor); const includeDiff = new URL(request.url).searchParams.get("diff") !== "0"; return json({ ...detail, diff: includeDiff ? await service.calculateMergeDiff(context.params.changeId, actor) : undefined }); }
  catch (error) { return collaborationErrorResponse(error) ?? authErrorResponse(error); }
}
