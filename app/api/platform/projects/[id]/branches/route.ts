import { z } from "zod";

import { authErrorResponse } from "@/lib/auth/api-response";
import { getAuthenticatedActor, requireAuthenticatedActor } from "@/lib/auth/session";
import { assertTrustedJsonRequest } from "@/lib/auth/request-security";
import { json } from "@/lib/api/http";
import { collaborationErrorResponse, CollaborationService } from "@/lib/services/collaboration";
import { getCollaborationRepository } from "@/lib/repositories/collaboration";
import { getPlatformRepository } from "@/lib/repositories/platform/platform-repository-factory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const branchSchema = z.object({ name: z.string().trim().min(1).max(120).regex(/^[^/\\]+(?:[/][^/\\]+)*$/).optional(), baseBranchId: z.string().trim().min(1).max(128).optional() }).strict();
function service(): CollaborationService { return new CollaborationService(getCollaborationRepository(), getPlatformRepository()); }

/** 保护分支只对游客公开；草稿分支需要由服务层按 owner/member 授权。 */
export async function GET(_request: Request, context: { params: { id: string } }) {
  try { return json({ branches: await service().listBranches(context.params.id, await getAuthenticatedActor()) }); }
  catch (error) { return collaborationErrorResponse(error) ?? authErrorResponse(error); }
}

/** 创建个人服务器草稿分支，默认从项目主分支复制当前树快照。 */
export async function POST(request: Request, context: { params: { id: string } }) {
  try { assertTrustedJsonRequest(request); const actor = await requireAuthenticatedActor(); const input = branchSchema.parse(await request.json()); return json({ branch: await service().createBranch({ ...input, projectId: context.params.id }, actor) }, { status: 201 }); }
  catch (error) { return collaborationErrorResponse(error) ?? authErrorResponse(error); }
}
