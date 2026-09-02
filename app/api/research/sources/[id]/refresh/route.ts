import { authErrorResponse } from "@/lib/auth/api-response";
import { requireAuthenticatedActor } from "@/lib/auth/session";
import { json } from "@/lib/api/http";
import { NotFoundError, ValidationError } from "@/lib/domain/errors";
import { PermissionDeniedError } from "@/lib/domain/platform";
import { getResearchRepository } from "@/lib/providers/repository-factory";
import { SearchSourceRefreshService } from "@/lib/services/search-source-refresh-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 只刷新当前用户拥有的 URL 来源；变更永远落为 needs_review，不覆盖 active 快照。 */
export async function POST(_request: Request, context: { params: { id: string } }) {
  try {
    const sourceId = context.params.id.trim();
    if (!sourceId || sourceId.length > 160) throw new ValidationError("来源 ID 无效");
    const actor = await requireAuthenticatedActor();
    const repository = getResearchRepository();
    const source = (await repository.getSnapshot()).sources.find((item) => item.id === sourceId);
    if (!source) throw new NotFoundError("来源不存在");
    // 历史手工来源没有 owner/project 归属，默认拒绝刷新；必须先通过受控导入建立归属。
    if (!source.ownerUserId || source.ownerUserId !== actor.userId) throw new PermissionDeniedError("只有来源所有者可以刷新该来源");
    const result = await new SearchSourceRefreshService(repository).refresh(sourceId);
    return json({ status: result.status, source: { id: result.source.id, state: result.source.state, capturedAt: result.source.capturedAt, contentHash: result.source.contentHash }, chunkCount: result.chunks.length }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return authErrorResponse(error);
  }
}
