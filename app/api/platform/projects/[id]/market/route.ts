import { json } from "@/lib/api/http";
import { PublicMarketService } from "@/lib/services/platform/public-market-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 公开项目历史行情；只返回已落库的有限序列，不接受任意 SQL 或外部 URL。 */
export async function GET(request: Request, context: { params: { id: string } }) {
  try {
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? 260);
    return json(await new PublicMarketService().list(context.params.id, Number.isFinite(limit) ? limit : 260));
  } catch { return json({ error: "行情数据暂时无法读取" }, { status: 503 }); }
}
