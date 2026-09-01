import { authErrorResponse } from "@/lib/auth/api-response";
import { requireAuthenticatedActor } from "@/lib/auth/session";
import { assertTrustedJsonRequest } from "@/lib/auth/request-security";
import { json } from "@/lib/api/http";
import { collaborationErrorResponse, CollaborationService } from "@/lib/services/collaboration";
import { getCollaborationRepository } from "@/lib/repositories/collaboration";
import { getPlatformRepository } from "@/lib/repositories/platform/platform-repository-factory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 合并必须显式 POST，并在事务内锁目标保护分支、检查版本和写入 Merge Commit。 */
export async function POST(request: Request, context: { params: { changeId: string } }) {
  try { assertTrustedJsonRequest(request); const actor = await requireAuthenticatedActor(); const mergeRequest = await new CollaborationService(getCollaborationRepository(), getPlatformRepository()).mergeMergeRequest(context.params.changeId, actor); return json({ mergeRequest }, { status: 200 }); }
  catch (error) { return collaborationErrorResponse(error) ?? authErrorResponse(error); }
}
