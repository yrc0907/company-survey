import { authErrorResponse } from "@/lib/auth/api-response";
import { getAuthenticatedActor } from "@/lib/auth/session";
import { json } from "@/lib/api/http";
import { CollaborationNotFoundError } from "@/lib/domain/collaboration";
import { collaborationErrorResponse, CollaborationService } from "@/lib/services/collaboration";
import { getCollaborationRepository } from "@/lib/repositories/collaboration";
import { getPlatformRepository } from "@/lib/repositories/platform/platform-repository-factory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 读取分支元数据；草稿权限由服务层处理，不能用 branchId 猜测项目。 */
export async function GET(_request: Request, context: { params: { branchId: string } }) {
  try { const actor = await getAuthenticatedActor(); const branch = await new CollaborationService(getCollaborationRepository(), getPlatformRepository()).getBranch(context.params.branchId, actor); if (!branch) throw new CollaborationNotFoundError("分支不存在"); return json({ branch }); }
  catch (error) { return collaborationErrorResponse(error) ?? authErrorResponse(error); }
}
