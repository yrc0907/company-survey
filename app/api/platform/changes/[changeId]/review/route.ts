import { z } from "zod";

import { authErrorResponse } from "@/lib/auth/api-response";
import { requireAuthenticatedActor } from "@/lib/auth/session";
import { assertTrustedJsonRequest } from "@/lib/auth/request-security";
import { json } from "@/lib/api/http";
import { collaborationErrorResponse, CollaborationService } from "@/lib/services/collaboration";
import { getCollaborationRepository } from "@/lib/repositories/collaboration";
import { getPlatformRepository } from "@/lib/repositories/platform/platform-repository-factory";
import { readIdempotencyKey } from "@/lib/services/collaboration/idempotency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({ verdict: z.enum(["comment", "approve", "request_changes", "reject"]), body: z.string().trim().max(10000).optional(), nodeId: z.string().trim().max(128).optional(), blockId: z.string().trim().max(256).optional() }).strict();

/** 逐段 Review；提交者不能审核自己的 MR，重复 Idempotency-Key 不产生第二条 Review。 */
export async function POST(request: Request, context: { params: { changeId: string } }) {
  try { assertTrustedJsonRequest(request); const actor = await requireAuthenticatedActor(); const input = schema.parse(await request.json()); const review = await new CollaborationService(getCollaborationRepository(), getPlatformRepository()).addReview({ ...input, mergeRequestId: context.params.changeId, idempotencyKey: readIdempotencyKey(request) }, actor); return json({ review }, { status: 201 }); }
  catch (error) { return collaborationErrorResponse(error) ?? authErrorResponse(error); }
}
