import { json } from "@/lib/api/http";
import { PublicHistoryDetailService } from "@/lib/services/platform/public-history-detail-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 公开主分支单个 Commit 的逐文件 Diff；草稿和私有项目统一按不存在处理。 */
export async function GET(_request: Request, context: { params: { id: string; commitId: string } }) {
  try {
    const detail = await new PublicHistoryDetailService().get(context.params.id, context.params.commitId);
    if (!detail) return json({ error: "公开版本不存在" }, { status: 404, headers: { "cache-control": "no-store" } });
    return json(detail, { headers: { "cache-control": "no-store" } });
  } catch {
    return json({ error: "版本 Diff 暂时无法读取" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
