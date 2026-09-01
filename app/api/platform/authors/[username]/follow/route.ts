import { z } from "zod";

import { authErrorResponse } from "@/lib/auth/api-response";
import { getAuthenticatedActor, requireAuthenticatedActor } from "@/lib/auth/session";
import { assertTrustedJsonRequest } from "@/lib/auth/request-security";
import { json } from "@/lib/api/http";
import { AuthorService } from "@/lib/services/platform/author-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const followSchema = z.object({}).strict();

/** 关注状态可匿名读取；匿名仅得到 following=false 与公开 follower 数量。 */
export async function GET(_request: Request, context: { params: { username: string } }) {
  try {
    const actor = await getAuthenticatedActor();
    const result = await new AuthorService().getFollowState(context.params.username, actor?.userId ?? null);
    return json({ ...result.data, source: result.source }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return authErrorResponse(error);
  }
}

/** 登录用户关注作者；请求体仅允许空对象，身份永远来自签名 Session。 */
export async function POST(request: Request, context: { params: { username: string } }) {
  try {
    assertTrustedJsonRequest(request);
    const actor = await requireAuthenticatedActor();
    followSchema.parse(await request.json());
    const result = await new AuthorService().setFollow(actor, context.params.username, true);
    return json({ ...result.data, source: result.source }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return authErrorResponse(error);
  }
}

/** DELETE 是显式取消语义，重复取消保持幂等并返回最新 follower 计数。 */
export async function DELETE(request: Request, context: { params: { username: string } }) {
  try {
    assertTrustedJsonRequest(request);
    const actor = await requireAuthenticatedActor();
    followSchema.parse(await request.json());
    const result = await new AuthorService().setFollow(actor, context.params.username, false);
    return json({ ...result.data, source: result.source }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return authErrorResponse(error);
  }
}
