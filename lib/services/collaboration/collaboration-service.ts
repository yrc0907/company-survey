import { KnowledgeCommandRegistry } from "@/lib/commands/knowledge";
import { CollaborationConflictError, CollaborationInvalidStateError, CollaborationNotFoundError, type BranchSummary, type CollaborationDiffEntry, type CommitSummary, type CreateBranchInput, type CreateMergeRequestInput, type CreateProjectInput, type CreateReviewInput, type MergeRequestSummary, type ProjectSummary, type ReviewSummary } from "@/lib/domain/collaboration";
import type { AuthenticatedActor } from "@/lib/domain/platform";
import type { PlatformRepository } from "@/lib/repositories/platform/platform-repository";
import type { CollaborationRepository } from "@/lib/repositories/collaboration/collaboration-repository";
import { AuthorizationService } from "@/lib/services/platform/authorization-service";
import { collaborationIdempotencyFingerprint } from "@/lib/services/collaboration/idempotency";

/** 协作应用服务：先做项目/分支授权，再调用领域仓储；不接受客户端声明的 userId。 */
export class CollaborationService {
  private readonly authorization: AuthorizationService;
  public constructor(private readonly repository: CollaborationRepository, platformRepository: PlatformRepository) { this.authorization = new AuthorizationService(platformRepository); }

  public listPublicProjects(search?: string): Promise<ProjectSummary[]> { return this.repository.listPublicProjects(search); }
  public getProject(projectId: string): Promise<ProjectSummary | null> { return this.repository.getProject(projectId); }

  public async createProject(input: CreateProjectInput, actor: AuthenticatedActor): Promise<ProjectSummary> {
    return this.repository.createProject(input, actor);
  }

  public async createBranch(input: CreateBranchInput, actor: AuthenticatedActor): Promise<BranchSummary> {
    await this.authorization.assertProjectAction(actor, input.projectId, "create_branch");
    return this.repository.createBranch(input, actor);
  }

  public async listBranches(projectId: string, actor: AuthenticatedActor | null): Promise<BranchSummary[]> {
    if (actor) await this.authorization.assertProjectAction(actor, projectId, "read_published");
    else {
      const project = await this.repository.getProject(projectId);
      if (!project || project.status !== "published" || project.visibility !== "public") throw new CollaborationNotFoundError("公开项目不存在");
    }
    const branches = await this.repository.listBranches(projectId);
    return actor ? branches.filter((branch) => branch.isProtected || branch.ownerUserId === actor.userId) : branches.filter((branch) => branch.isProtected);
  }

  /** 读取单个分支；保护分支可匿名读取，草稿分支必须验证 owner/member 权限。 */
  public async getBranch(branchId: string, actor: AuthenticatedActor | null): Promise<BranchSummary | null> {
    const branch = await this.repository.getBranch(branchId);
    if (!branch) return null;
    if (branch.isProtected) {
      if (!actor) {
        const project = await this.repository.getProject(branch.projectId);
        if (!project || project.visibility !== "public" || project.status !== "published") throw new CollaborationNotFoundError("分支不存在");
      } else await this.authorization.assertProjectAction(actor, branch.projectId, "read_published");
      return branch;
    }
    if (!actor) throw new CollaborationNotFoundError("分支不存在");
    await this.authorization.assertBranchAction(actor, branch.projectId, branch.id, "read_draft");
    return branch;
  }

  public async executeCommand(input: import("@/lib/domain/collaboration").ExecuteCommandInput, actor: AuthenticatedActor): Promise<{ commit: CommitSummary | null; replayed: boolean }> {
    const branch = await this.repository.getBranch(input.branchId); if (!branch) throw new CollaborationNotFoundError("分支不存在");
    await this.authorization.assertBranchAction(actor, branch.projectId, input.branchId, "write_branch");
    const idempotencyFingerprint = input.idempotencyKey
      ? collaborationIdempotencyFingerprint("knowledge-command", { branchId: input.branchId, actorId: actor.userId, command: input.command, message: input.message ?? "", aiAssisted: input.aiAssisted ?? false })
      : undefined;
    if (input.idempotencyKey) {
      const prior = await this.repository.getCommitByIdempotency(input.branchId, input.idempotencyKey, idempotencyFingerprint);
      if (prior) return { commit: prior, replayed: true };
    }
    const store = this.repository.createCommandStore({ branchId: input.branchId, expectedVersion: input.expectedVersion, idempotencyKey: input.idempotencyKey, idempotencyFingerprint, message: input.message, aiAssisted: input.aiAssisted });
    const registry = new KnowledgeCommandRegistry(store);
    let result: Awaited<ReturnType<typeof registry.execute>>;
    try {
      result = await registry.execute(input.branchId, { userId: actor.userId }, input.command);
    } catch (error) {
      // 另一个请求可能在本次校验后先完成提交；此时 Registry 的业务校验可能看到已存在节点。
      // 回查同一指纹可把并发重试还原为幂等响应，真正的同名/非法命令仍原样抛出。
      if (input.idempotencyKey) {
        const prior = await this.repository.getCommitByIdempotency(input.branchId, input.idempotencyKey, idempotencyFingerprint);
        if (prior) return { commit: prior, replayed: true };
      }
      throw error;
    }
    const commit = input.idempotencyKey ? await this.repository.getCommitByIdempotency(input.branchId, input.idempotencyKey) : await this.repository.getCommit(input.branchId, result.change.id);
    return { commit, replayed: false };
  }

  public async createMergeRequest(input: CreateMergeRequestInput, actor: AuthenticatedActor): Promise<MergeRequestSummary> {
    const source = await this.repository.getBranch(input.sourceBranchId); const target = await this.repository.getBranch(input.targetBranchId);
    if (!source || !target || source.projectId !== input.projectId || target.projectId !== input.projectId) throw new CollaborationNotFoundError("源或目标分支不存在");
    await this.authorization.assertBranchAction(actor, input.projectId, input.sourceBranchId, "submit_merge_request");
    if (!target.isProtected) throw new CollaborationInvalidStateError("目标分支必须是保护分支");
    if (source.status !== "active") throw new CollaborationInvalidStateError("该草稿分支已提交或关闭，请基于最新版本新建分支");
    if (target.status !== "active") throw new CollaborationInvalidStateError("目标主分支当前不可接受新的修改申请");
    return this.repository.createMergeRequest(input, actor);
  }

  /** 公开申请列表只返回非草稿状态；详情和 Diff 仍需项目草稿读取权限。 */
  public async listMergeRequests(projectId: string, actor: AuthenticatedActor | null): Promise<MergeRequestSummary[]> {
    const project = await this.repository.getProject(projectId);
    if (!project || project.visibility !== "public" || project.status !== "published") throw new CollaborationNotFoundError("公开项目不存在");
    const requests = await this.repository.listMergeRequests(projectId);
    if (!actor) return requests.filter((item) => item.status !== "closed");
    return requests.filter((item) => item.status !== "closed" || item.authorUserId === actor.userId);
  }

  public async getMergeRequest(id: string, actor: AuthenticatedActor): Promise<{ mergeRequest: MergeRequestSummary; reviews: ReviewSummary[] }> {
    const mergeRequest = await this.repository.getMergeRequest(id); if (!mergeRequest) throw new CollaborationNotFoundError("合并申请不存在");
    await this.assertMergeProjectAction(actor, mergeRequest, "read_draft");
    return { mergeRequest, reviews: await this.repository.listReviews(id) };
  }

  public async calculateMergeDiff(id: string, actor: AuthenticatedActor): Promise<{ mergeRequest: MergeRequestSummary; entries: CollaborationDiffEntry[] }> {
    const mergeRequest = await this.repository.getMergeRequest(id); if (!mergeRequest) throw new CollaborationNotFoundError("合并申请不存在");
    await this.assertMergeProjectAction(actor, mergeRequest, "read_draft");
    return this.repository.calculateMergeDiff(id);
  }

  public async addReview(input: CreateReviewInput, actor: AuthenticatedActor): Promise<ReviewSummary> {
    const mergeRequest = await this.repository.getMergeRequest(input.mergeRequestId); if (!mergeRequest) throw new CollaborationNotFoundError("合并申请不存在");
    await this.authorization.assertProjectAction(actor, mergeRequest.projectId, "review_merge_request");
    if (mergeRequest.authorUserId === actor.userId) throw new CollaborationInvalidStateError("提交者不能审核自己的合并申请");
    if (input.verdict === "comment" && !input.body?.trim()) throw new CollaborationInvalidStateError("逐段评论必须填写内容");
    if (input.verdict === "approve" && mergeRequest.conflictStatus === "conflict") throw new CollaborationConflictError("存在未解决冲突，不能批准合并申请", mergeRequest.conflictDetails);
    return this.repository.addReview(input, actor);
  }

  public async mergeMergeRequest(id: string, actor: AuthenticatedActor): Promise<MergeRequestSummary> {
    const mergeRequest = await this.repository.getMergeRequest(id); if (!mergeRequest) throw new CollaborationNotFoundError("合并申请不存在");
    await this.authorization.assertProjectAction(actor, mergeRequest.projectId, "merge");
    return this.repository.mergeMergeRequest(id, actor);
  }

  private async assertMergeProjectAction(actor: AuthenticatedActor, mergeRequest: MergeRequestSummary, action: "read_draft"): Promise<void> {
    // 以源草稿分支作为二次边界：普通 contributor 只能读取自己的分支，维护者/owner 才能审阅他人草稿。
    await this.authorization.assertBranchAction(actor, mergeRequest.projectId, mergeRequest.sourceBranchId, action);
  }
}
