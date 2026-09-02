import { json } from "@/lib/api/http";
import { PublicHistoryService } from "@/lib/services/platform/public-history-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 公开主分支 Commit 历史；仅返回 public/published 项目的追加式元数据。 */
export async function GET(request: Request, context: { params: { id: string } }) {
  try {
    const raw = Number(new URL(request.url).searchParams.get("limit") ?? 50);
    return json(await new PublicHistoryService().list(context.params.id, Number.isFinite(raw) ? raw : 50), { headers: { "cache-control": "no-store" } });
  } catch { return json({ error: "版本历史暂时无法读取" }, { status: 503 }); }
}
