import { errorResponse, json } from "@/lib/api/http";
import { getResearchRepository } from "@/lib/providers/repository-factory";
import { SearchService } from "@/lib/services/search-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 在已导入资料中执行确定性全文/关键词检索；不调用外网或模型。 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q") ?? "";
    const reportId = searchParams.get("reportId") ?? undefined;
    const limitValue = Number(searchParams.get("limit") ?? "12");
    const hits = await new SearchService(getResearchRepository()).search(q, { reportId, limit: Number.isFinite(limitValue) ? limitValue : 12 });
    return json({ query: q, hits });
  } catch (error) {
    return errorResponse(error);
  }
}
