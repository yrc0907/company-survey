import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth/options";
import { AuthenticationRequiredError, type AuthenticatedActor } from "@/lib/domain/platform";
import { getPlatformRepository } from "@/lib/repositories/platform/platform-repository-factory";

let actorResolverOverride: (() => Promise<AuthenticatedActor | null>) | null = null;

/** 从签名 Session 提取最小 actor；缺字段时 fail closed，不信任请求 Body 中的用户或角色。 */
export async function getAuthenticatedActor(): Promise<AuthenticatedActor | null> {
  if (actorResolverOverride) return actorResolverOverride();
  const session = await getServerSession(authOptions);
  const sessionUser = session?.user;
  if (!sessionUser?.id || !sessionUser.role) return null;

  // JWT 只证明“曾经登录过”；每个受保护请求都回源数据库确认账户仍 active，
  // 这样暂停/删除账户、角色变更会立即撤销旧会话，而不是等待 JWT 过期。
  try {
    const account = await getPlatformRepository().findAccountById(sessionUser.id);
    if (!account || account.status !== "active" || account.role !== sessionUser.role) return null;
    return { userId: account.id, role: account.role };
  } catch {
    // 身份事实无法确认时 fail closed，不能把数据库故障降级为可写的 JWT 身份。
    return null;
  }
}

/** 写接口的规范入口：返回可信 actor；无会话时抛出可映射为 401 的领域错误。 */
export async function requireAuthenticatedActor(): Promise<AuthenticatedActor> {
  const actor = await getAuthenticatedActor();
  if (!actor) throw new AuthenticationRequiredError();
  return actor;
}

/** 契约测试注入会话身份，避免伪造 Cookie 或绕过生产验证逻辑。 */
export function setAuthenticatedActorResolverForTest(resolver: (() => Promise<AuthenticatedActor | null>) | null): void {
  actorResolverOverride = resolver;
}
