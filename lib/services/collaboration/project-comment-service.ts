import { CollaborationInvalidStateError, CollaborationNotFoundError, type CreateProjectCommentInput, type ProjectCommentSummary } from "@/lib/domain/collaboration";
import { PermissionDeniedError, type AuthenticatedActor } from "@/lib/domain/platform";
import type { CollaborationRepository } from "@/lib/repositories/collaboration/collaboration-repository";
import type { PlatformRepository } from "@/lib/repositories/platform/platform-repository";
import { AuthorizationService } from "@/lib/services/platform/authorization-service";
import { collaborationIdempotencyFingerprint } from "@/lib/services/collaboration/idempotency";

/** 项目级评论应用服务：公开项目可匿名读取，所有写入和删除都经过真实 Session 与项目边界。 */
export class ProjectCommentService {
  private readonly authorization: AuthorizationService;

  public constructor(private readonly repository: CollaborationRepository, private readonly platformRepository: PlatformRepository) {
    this.authorization = new AuthorizationService(platformRepository);
  }

  /** 返回平铺评论列表；客户端按 parentId 渲染楼中楼，删除节点仍保留。 */
  public async list(projectId: string, actor: AuthenticatedActor | null): Promise<ProjectCommentSummary[]> {
    await this.assertPublicProject(projectId);
    const comments = await this.repository.listProjectComments(projectId);
    return this.decorateDeletePermission(comments, actor);
  }

  /** 登录用户创建评论；父评论必须属于同一公开项目，身份不接受客户端传入。 */
  public async create(input: CreateProjectCommentInput, actor: AuthenticatedActor): Promise<ProjectCommentSummary> {
    await this.assertPublicProject(input.projectId);
    await this.authorization.assertProjectAction(actor, input.projectId, "read_published");
    const body = input.body.trim();
    if (!body) throw new CollaborationInvalidStateError("评论内容不能为空");
    if (body.length > 10000) throw new CollaborationInvalidStateError("评论内容不能超过 10000 个字符");
    const normalized: CreateProjectCommentInput = { ...input, body, parentId: input.parentId ?? null };
    const fingerprint = input.idempotencyKey
      ? collaborationIdempotencyFingerprint("project-comment", { actorId: actor.userId, projectId: input.projectId, parentId: normalized.parentId, body })
      : undefined;
    if (input.idempotencyKey) {
      const prior = await this.repository.getProjectCommentByIdempotency(input.projectId, actor.userId, input.idempotencyKey, fingerprint);
      if (prior) return (await this.decorateDeletePermission([prior], actor))[0]!;
    }
    const comment = await this.repository.createProjectComment({ ...normalized, idempotencyKey: input.idempotencyKey }, actor, fingerprint);
    return (await this.decorateDeletePermission([comment], actor))[0]!;
  }

  /** 作者本人或项目 owner/maintainer 可软删除；删除不会影响子回复。 */
  public async remove(commentId: string, actor: AuthenticatedActor, expectedProjectId?: string): Promise<ProjectCommentSummary> {
    const comment = await this.repository.getProjectComment(commentId);
    if (!comment) throw new CollaborationNotFoundError("评论不存在");
    if (expectedProjectId && comment.projectId !== expectedProjectId) throw new CollaborationNotFoundError("评论不存在");
    await this.assertPublicProject(comment.projectId);
    const access = await this.getProjectAccess(comment.projectId, actor.userId);
    const canDelete = comment.authorUserId === actor.userId
      || access?.ownerUserId === actor.userId
      || access?.memberRole === "owner"
      || access?.memberRole === "maintainer";
    if (!canDelete) throw new PermissionDeniedError("只能删除自己的评论或项目管理者可删除评论");
    const deleted = await this.repository.softDeleteProjectComment(commentId, actor);
    return (await this.decorateDeletePermission([deleted], actor))[0]!;
  }

  private async assertPublicProject(projectId: string): Promise<void> {
    const project = await this.repository.getProject(projectId);
    if (!project || project.visibility !== "public" || project.status !== "published") throw new CollaborationNotFoundError("公开项目不存在");
  }

  private async getProjectAccess(projectId: string, userId: string): Promise<Awaited<ReturnType<PlatformRepository["getProjectAccess"]>>> {
    // 通过平台仓储读取角色，不在评论表复制成员权限，防止权限变更后出现陈旧授权。
    return this.platformRepository.getProjectAccess(projectId, userId);
  }

  private async decorateDeletePermission(comments: ProjectCommentSummary[], actor: AuthenticatedActor | null): Promise<ProjectCommentSummary[]> {
    if (!actor || comments.length === 0) return comments.map((comment) => ({ ...comment, canDelete: false }));
    const access = await this.getProjectAccess(comments[0]!.projectId, actor.userId);
    const elevated = access?.ownerUserId === actor.userId || access?.memberRole === "owner" || access?.memberRole === "maintainer";
    return comments.map((comment) => ({ ...comment, canDelete: actor.userId === comment.authorUserId || Boolean(elevated) }));
  }
}
