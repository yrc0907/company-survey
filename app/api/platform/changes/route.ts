import { z } from "zod";

import { authErrorResponse } from "@/lib/auth/api-response";
import { getAuthenticatedActor, requireAuthenticatedActor } from "@/lib/auth/session";
import { assertTrustedJsonRequest } from "@/lib/auth/request-security";
import { json } from "@/lib/api/http";
import { collaborationErrorResponse, CollaborationService } from "@/lib/services/collaboration";
import { getCollaborationRepository } from "@/lib/repositories/collaboration";
import { getPlatformRepository } from "@/lib/repositories/platform/platform-repository-factory";
import { readIdempotencyKey } from "@/lib/services/collaboration/idempotency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({ projectId: z.string().trim().min(1).max(128), sourceBranchId: z.string().trim().min(1).max(128), targetBranchId: z.string().trim().min(1).max(128), title: z.string().trim().min(1).max(200), description: z.string().trim().max(5000).optional() }).strict();

/** 创建 MR；Idempotency-Key 由服务端与源/目标分支联合约束，重复请求返回原 MR。 */
export async function POST(request: Request) {
  try { assertTrustedJsonRequest(request); const actor = await requireAuthenticatedActor(); const input = schema.parse(await request.json()); const idempotencyKey = readIdempotencyKey(request); const mergeRequest = await new CollaborationService(getCollaborationRepository(), getPlatformRepository()).createMergeRequest({ ...input, idempotencyKey }, actor); return json({ mergeRequest }, { status: 201 }); }
  catch (error) { return collaborationErrorResponse(error) ?? authErrorResponse(error); }
}

/** 公开查看非草稿申请；匿名用户不会获得 Diff、私有分支或评论正文。 */
export async function GET(request: Request) {
  try {
    const projectId = new URL(request.url).searchParams.get("projectId")?.trim();
    if (!projectId) return json({ error: "缺少 projectId", code: "VALIDATION_ERROR" }, { status: 400 });
    // 没有持久化库时公开 Seed 仍可匿名阅读，但不能把静态计数伪装成真实 MR。
    if (!process.env.DATABASE_URL?.trim()) return json({ mergeRequests: [], source: "typed_seed" });
    const actor = await getAuthenticatedActor();
    const mergeRequests = await new CollaborationService(getCollaborationRepository(), getPlatformRepository()).listMergeRequests(projectId, actor);
    return json({ mergeRequests });
  } catch (error) { return collaborationErrorResponse(error) ?? authErrorResponse(error); }
}
