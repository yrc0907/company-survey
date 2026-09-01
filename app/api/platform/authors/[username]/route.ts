import { authErrorResponse } from "@/lib/auth/api-response";
import { getAuthenticatedActor } from "@/lib/auth/session";
import { json } from "@/lib/api/http";
import { AuthorService } from "@/lib/services/platform/author-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 公开作者主页：只返回 active 用户和已发布项目；关注状态按当前 Session 投影。 */
export async function GET(_request: Request, context: { params: { username: string } }) {
  try {
    const actor = await getAuthenticatedActor();
    const result = await new AuthorService().getProfile(context.params.username, actor?.userId ?? null);
    return json({ author: result.data, source: result.source }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return authErrorResponse(error);
  }
}
