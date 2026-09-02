import { z } from "zod";

import { json, errorResponse } from "@/lib/api/http";
import { PublicActivityService } from "@/lib/services/platform/public-activity-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  before: z.string().trim().max(64).optional(),
}).strict();

/** 匿名可读的项目活动；项目是否公开由服务层和 PostgreSQL 同时校验。 */
export async function GET(request: Request, context: { params: { id: string } }) {
  try {
    const url = new URL(request.url);
    const query = querySchema.parse({ limit: url.searchParams.get("limit") ?? undefined, before: url.searchParams.get("before") ?? undefined });
    const result = await new PublicActivityService().list({ projectIdOrSlug: context.params.id, limit: query.limit, before: query.before });
    return json({ events: result.data, source: result.source }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
