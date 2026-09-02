import { authErrorResponse } from "@/lib/auth/api-response";
import { assertTrustedJsonRequest } from "@/lib/auth/request-security";
import { requireAuthenticatedActor } from "@/lib/auth/session";
import { json } from "@/lib/api/http";
import { getPlatformRepository } from "@/lib/repositories/platform/platform-repository-factory";
import { PublicRevertService } from "@/lib/services/platform/public-revert-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 维护者显式回滚当前公开 HEAD；服务端以新 Commit 记录，不修改历史。 */
export async function POST(request: Request, context: { params: { id: string; commitId: string } }) {
  try {
    assertTrustedJsonRequest(request);
    const actor = await requireAuthenticatedActor();
    const result = await new PublicRevertService(getPlatformRepository()).revert(context.params.id, context.params.commitId, actor);
    return json(result, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) { return authErrorResponse(error); }
}
