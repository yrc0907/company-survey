import { AuthenticationRequiredError } from "@/lib/domain/platform";
import { authErrorResponse } from "@/lib/auth/api-response";
import { requireAuthenticatedActor } from "@/lib/auth/session";
import { json } from "@/lib/api/http";
import { getPlatformRepository } from "@/lib/repositories/platform/platform-repository-factory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 返回当前会话账户；用户 ID 和角色来自签名 Session，再用数据库刷新公开资料。 */
export async function GET() {
  try {
    const actor = await requireAuthenticatedActor();
    const account = await getPlatformRepository().findAccountById(actor.userId);
    if (!account || account.status !== "active") throw new AuthenticationRequiredError("会话已失效，请重新登录");
    return json({ account });
  } catch (error) {
    return authErrorResponse(error);
  }
}
