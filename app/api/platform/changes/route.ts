import { z } from "zod";

import { authErrorResponse } from "@/lib/auth/api-response";
import { requireAuthenticatedActor } from "@/lib/auth/session";
import { assertTrustedJsonRequest } from "@/lib/auth/request-security";
import { json } from "@/lib/api/http";
import { collaborationErrorResponse, CollaborationService } from "@/lib/services/collaboration";
import { getCollaborationRepository } from "@/lib/repositories/collaboration";
import { getPlatformRepository } from "@/lib/repositories/platform/platform-repository-factory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({ projectId: z.string().trim().min(1).max(128), sourceBranchId: z.string().trim().min(1).max(128), targetBranchId: z.string().trim().min(1).max(128), title: z.string().trim().min(1).max(200), description: z.string().trim().max(5000).optional() }).strict();

/** 创建 MR；Idempotency-Key 由服务端与源/目标分支联合约束，重复请求返回原 MR。 */
export async function POST(request: Request) {
  try { assertTrustedJsonRequest(request); const actor = await requireAuthenticatedActor(); const input = schema.parse(await request.json()); const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() || undefined; const mergeRequest = await new CollaborationService(getCollaborationRepository(), getPlatformRepository()).createMergeRequest({ ...input, idempotencyKey }, actor); return json({ mergeRequest }, { status: idempotencyKey && mergeRequest.authorUserId === actor.userId ? 200 : 201 }); }
  catch (error) { return collaborationErrorResponse(error) ?? authErrorResponse(error); }
}
