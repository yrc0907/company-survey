import { json } from "@/lib/api/http";
import { ValidationError } from "@/lib/domain/errors";
import { GlobalSearchService } from "@/lib/services/platform/global-search-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 匿名可用的全站公开搜索；搜索服务内部只查询已发布项目、活跃作者和保护分支文档。
 * 失败响应不暴露数据库或全文检索实现细节，客户端可据此展示统一错误状态。
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query = url.searchParams.get("q") ?? "";
    const rawLimit = url.searchParams.get("limit");
    const limit = rawLimit == null ? undefined : Number(rawLimit);
    if (rawLimit != null && (!Number.isFinite(limit) || !Number.isInteger(limit))) throw new ValidationError("limit 必须是整数");
    const result = await new GlobalSearchService().search({ query, limit });
    return json({ results: result.data, source: result.source }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof ValidationError) return json({ error: error.message, code: "VALIDATION_ERROR" }, { status: 400 });
    console.error("Global public search error", error);
    return json({ error: "搜索暂时不可用", code: "SEARCH_UNAVAILABLE" }, { status: 500 });
  }
}
