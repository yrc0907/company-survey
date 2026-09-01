import { canPerformBranchAction, canPerformProjectAction, PermissionDeniedError, type AuthenticatedActor, type ProjectAction } from "@/lib/domain/platform";
import type { PlatformRepository } from "@/lib/repositories/platform/platform-repository";

/** 统一执行项目权限判定，API、命令和 AI Patch 必须共用该服务。 */
export class AuthorizationService {
  public constructor(private readonly repository: PlatformRepository) {}

  /** 输入 actor/project/action，成功无返回；失败抛出拒绝错误且不产生副作用。 */
  public async assertProjectAction(actor: AuthenticatedActor | null, projectId: string, action: ProjectAction): Promise<void> {
    const project = await this.repository.getProjectAccess(projectId, actor?.userId ?? null);
    if (!canPerformProjectAction(actor, project, action)) throw new PermissionDeniedError();
  }

  /** 草稿读取/写入/提交必须同时校验项目成员关系与目标分支，不允许只凭 project 权限。 */
  public async assertBranchAction(
    actor: AuthenticatedActor | null,
    projectId: string,
    branchId: string,
    action: Extract<ProjectAction, "read_draft" | "write_branch" | "submit_merge_request">,
  ): Promise<void> {
    const [project, branch] = await Promise.all([
      this.repository.getProjectAccess(projectId, actor?.userId ?? null),
      this.repository.getBranchAccess(projectId, branchId),
    ]);
    if (!canPerformBranchAction(actor, project, branch, action)) throw new PermissionDeniedError();
  }
}
