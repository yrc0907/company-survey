import type { MemoryActor } from "@/lib/domain/memory";

/** 身份模块接线点；实现只能从服务端 Session 获取身份，禁止信任请求体或普通请求头的 userId。 */
export interface ActorResolver {
  resolve(request: Request): Promise<MemoryActor | null>;
}

/** 默认拒绝实现，Auth.js 尚未接线时 API 不会误把匿名请求当成登录用户。 */
class FailClosedActorResolver implements ActorResolver {
  public async resolve(): Promise<null> {
    return null;
  }
}

let resolver: ActorResolver = new FailClosedActorResolver();

/** 返回当前身份适配器；生产整合时由 Auth.js 启动代码注入一次。 */
export function getActorResolver(): ActorResolver {
  return resolver;
}

/** 仅供应用启动接线和契约测试替换身份解析器；传 null 恢复 fail-closed。 */
export function setActorResolver(next: ActorResolver | null): void {
  resolver = next ?? new FailClosedActorResolver();
}

