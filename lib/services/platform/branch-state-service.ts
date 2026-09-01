import type { AuthenticatedActor, KnowledgeNodeState } from "@/lib/domain/platform";
import type { PlatformRepository } from "@/lib/repositories/platform/platform-repository";
import { AuthorizationService } from "@/lib/services/platform/authorization-service";

/** 分支文件树读取服务，先授权后查状态；不存在与越权均不会回退到 main 或其他分支。 */
export class BranchStateService {
  private readonly authorization: AuthorizationService;

  public constructor(private readonly repository: PlatformRepository) {
    this.authorization = new AuthorizationService(repository);
  }

  /** 输入明确 project/branch/node Scope，输出该分支唯一状态；无副作用。 */
  public async getNodeState(actor: AuthenticatedActor, projectId: string, branchId: string, nodeId: string): Promise<KnowledgeNodeState | null> {
    await this.authorization.assertBranchAction(actor, projectId, branchId, "read_draft");
    return this.repository.getNodeState(projectId, branchId, nodeId);
  }
}
