import { z } from "zod";

import { authErrorResponse } from "@/lib/auth/api-response";
import { requireAuthenticatedActor } from "@/lib/auth/session";
import { json } from "@/lib/api/http";
import { getPlatformRepository } from "@/lib/repositories/platform/platform-repository-factory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) });

/** 只返回当前账户的邮箱/手机号绑定审计；目标原文永不进入响应。 */
export async function GET(request: Request): Promise<Response> {
  try {
    const actor = await requireAuthenticatedActor();
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const entries = await getPlatformRepository().listIdentityAudit(actor.userId, query.limit);
    return json({ entries }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return authErrorResponse(error);
  }
}
