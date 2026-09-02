import { z } from "zod";

import { errorResponse, json } from "@/lib/api/http";
import { requireAuthenticatedActor } from "@/lib/auth/session";
import { getNotificationRepository } from "@/lib/repositories/platform/notification-repository-factory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const querySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30), before: z.string().datetime().optional() }).strict();

/** 读取当前用户通知；actor 只来自 Auth.js Session，响应不包含邮箱和私有正文。 */
export async function GET(request: Request): Promise<Response> {
  try {
    const actor = await requireAuthenticatedActor();
    const url = new URL(request.url);
    const query = querySchema.parse({ limit: url.searchParams.get("limit") ?? undefined, before: url.searchParams.get("before") ?? undefined });
    return json(await getNotificationRepository().list({ userId: actor.userId, limit: query.limit, before: query.before }), { headers: { "cache-control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
