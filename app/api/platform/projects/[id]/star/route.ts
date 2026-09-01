import { z } from "zod";

import { json } from "@/lib/api/http";
import { assertTrustedJsonRequest } from "@/lib/auth/request-security";
import { authErrorResponse } from "@/lib/auth/api-response";
import { getAuthenticatedActor, requireAuthenticatedActor } from "@/lib/auth/session";
import { PublicProjectService } from "@/lib/services/platform/public-project-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const starSchema = z.object({ starred: z.boolean() }).strict();

/** 公开 Star 状态可匿名读取；若配置了 Session，会额外返回当前用户是否已收藏。 */
export async function GET(_request: Request, context: { params: { id: string } }) {
  try {
    const actor = await getAuthenticatedActor();
    const result = await new PublicProjectService().getStarState(context.params.id, actor?.userId ?? null);
    return json({ ...result.data, source: result.source }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return authErrorResponse(error);
  }
}

/** 登录用户设置 Star；服务端忽略请求体中所有身份字段，只接受 starred 布尔值。 */
export async function POST(request: Request, context: { params: { id: string } }) {
  try {
    assertTrustedJsonRequest(request);
    const actor = await requireAuthenticatedActor();
    const input = starSchema.parse(await request.json());
    const result = await new PublicProjectService().setStar(actor, context.params.id, input.starred);
    return json({ ...result.data, source: result.source }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return authErrorResponse(error);
  }
}

/** DELETE 是 POST 的明确取消语义，保持 REST 客户端和键盘操作都能幂等取消收藏。 */
export async function DELETE(request: Request, context: { params: { id: string } }) {
  try {
    assertTrustedJsonRequest(request);
    const actor = await requireAuthenticatedActor();
    const result = await new PublicProjectService().setStar(actor, context.params.id, false);
    return json({ ...result.data, source: result.source }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return authErrorResponse(error);
  }
}

