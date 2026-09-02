import { z } from "zod";

import { assertTrustedJsonRequest } from "@/lib/auth/request-security";
import { requireAuthenticatedActor } from "@/lib/auth/session";
import { json } from "@/lib/api/http";
import { getAssetsRepository } from "@/lib/repositories/assets";
import { assetErrorResponse } from "@/lib/services/assets/asset-api-response";
import { VISION_REVIEW_MAX_TEXT, VisionReviewService } from "@/lib/services/assets/vision-review-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inputSchema = z.object({ artifactId: z.string().trim().min(1).max(160), text: z.string().min(1).max(VISION_REVIEW_MAX_TEXT) }).strict();

/** 确认视觉待校对草稿；需要真实 Session，正文只写入追加式 text 解析产物。 */
export async function POST(request: Request, context: { params: { id: string } }) {
  try {
    assertTrustedJsonRequest(request);
    const actor = await requireAuthenticatedActor();
    const input = inputSchema.parse(await request.json());
    const result = await new VisionReviewService(getAssetsRepository()).approve(actor, context.params.id, input);
    return json(result, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) { return assetErrorResponse(error); }
}
