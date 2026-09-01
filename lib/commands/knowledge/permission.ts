import type { KnowledgeBranchContext, KnowledgeCommandActor, KnowledgeCommandPermission } from "@/lib/commands/knowledge/types";

/** 默认命令权限：游客只能改本地草稿；登录用户只能改自己拥有的服务器草稿。 */
export class DefaultKnowledgeCommandPermission implements KnowledgeCommandPermission {
  public assertCanWrite(actor: KnowledgeCommandActor, branch: KnowledgeBranchContext): void {
    if (branch.status !== "active") throw new Error("当前分支不是可编辑状态。" );
    if (branch.storage === "published") throw new Error("公开主版本禁止直接修改，请先创建草稿分支。" );
    if (branch.storage === "local_guest") {
      if (actor.userId || !actor.localDraftId || actor.localDraftId !== branch.ownerId) throw new Error("游客只能修改自己的本地草稿。" );
      return;
    }
    if (!actor.userId || actor.userId !== branch.ownerId) throw new Error("无权修改该服务器草稿。" );
  }
}
