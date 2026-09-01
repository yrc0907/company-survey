import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth/options";
import { AuthenticationRequiredError, type AuthenticatedActor } from "@/lib/domain/platform";

let actorResolverOverride: (() => Promise<AuthenticatedActor | null>) | null = null;

/** 从签名 Session 提取最小 actor；缺字段时 fail closed，不信任请求 Body 中的用户或角色。 */
export async function getAuthenticatedActor(): Promise<AuthenticatedActor | null> {
  if (actorResolverOverride) return actorResolverOverride();
  const session = await getServerSession(authOptions);
  return session?.user?.id && session.user.role ? { userId: session.user.id, role: session.user.role } : null;
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
