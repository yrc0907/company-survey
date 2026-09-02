import { CollaborationInvalidStateError, CollaborationNotFoundError, type CreateProjectCommentInput, type ProjectCommentSummary } from "@/lib/domain/collaboration";
import type { CommentAttachmentRepository, CommentAttachmentSummary } from "@/lib/domain/collaboration";
import { PermissionDeniedError, type AuthenticatedActor } from "@/lib/domain/platform";
import type { CommentAttachmentRecord } from "@/lib/domain/collaboration";
import type { CollaborationRepository } from "@/lib/repositories/collaboration/collaboration-repository";
import type { PlatformRepository } from "@/lib/repositories/platform/platform-repository";
import { AuthorizationService } from "@/lib/services/platform/authorization-service";
import { collaborationIdempotencyFingerprint } from "@/lib/services/collaboration/idempotency";

/** 项目级评论应用服务：公开项目可匿名读取，所有写入和删除都经过真实 Session 与项目边界。 */
export class ProjectCommentService {
  private readonly authorization: AuthorizationService;

  public constructor(
    private readonly repository: CollaborationRepository,
    private readonly platformRepository: PlatformRepository,
    private readonly attachmentRepository: CommentAttachmentRepository | null = null,
    private readonly signAttachment: ((objectKey: string) => Promise<{ url: string; expiresInSeconds: number }>) | null = null,
  ) {
    this.authorization = new AuthorizationService(platformRepository);
  }

  /** 返回平铺评论列表；客户端按 parentId 渲染楼中楼，删除节点仍保留。 */
  public async list(projectId: string, actor: AuthenticatedActor | null): Promise<ProjectCommentSummary[]> {
    await this.assertPublicProject(projectId);
    const comments = await this.repository.listProjectComments(projectId);
    return this.decorateAttachments(await this.decorateDeletePermission(comments, actor));
  }

  /** 登录用户创建评论；父评论必须属于同一公开项目，身份不接受客户端传入。 */
  public async create(input: CreateProjectCommentInput, actor: AuthenticatedActor): Promise<ProjectCommentSummary> {
    await this.assertPublicProject(input.projectId);
    await this.authorization.assertProjectAction(actor, input.projectId, "read_published");
    const body = input.body.trim();
    if (!body) throw new CollaborationInvalidStateError("评论内容不能为空");
    if (body.length > 10000) throw new CollaborationInvalidStateError("评论内容不能超过 10000 个字符");
    const nodeId = input.nodeId?.trim() || null;
    const blockId = input.blockId?.trim() || null;
    const quote = input.quote?.trim() || null;
    if (Boolean(nodeId) !== Boolean(blockId) || Boolean(nodeId) !== Boolean(quote)) throw new CollaborationInvalidStateError("段落评论必须同时提供文件、段落和引用片段");
    if (nodeId && nodeId.length > 128) throw new CollaborationInvalidStateError("评论锚点文件无效");
    if (blockId && blockId.length > 128) throw new CollaborationInvalidStateError("评论锚点段落无效");
    if (quote && quote.length > 2000) throw new CollaborationInvalidStateError("评论引用片段不能超过 2000 个字符");
    const attachmentAssetIds = Array.from(new Set((input.attachmentAssetIds ?? []).map((id) => id.trim()).filter(Boolean)));
    if (attachmentAssetIds.length > 4) throw new CollaborationInvalidStateError("一条评论最多添加 4 个图片或 GIF 附件");
    if (attachmentAssetIds.length && !this.attachmentRepository) throw new CollaborationInvalidStateError("评论附件服务暂不可用");
    const normalized: CreateProjectCommentInput = { ...input, body, parentId: input.parentId ?? null, nodeId, blockId, quote, attachmentAssetIds };
    const fingerprint = input.idempotencyKey
      ? collaborationIdempotencyFingerprint("project-comment", { actorId: actor.userId, projectId: input.projectId, parentId: normalized.parentId, nodeId, blockId, quote, body })
      : undefined;
    if (input.idempotencyKey) {
      const prior = await this.repository.getProjectCommentByIdempotency(input.projectId, actor.userId, input.idempotencyKey, fingerprint);
      if (prior) return (await this.decorateAttachments(await this.decorateDeletePermission([prior], actor)))[0]!;
    }
    const comment = await this.repository.createProjectComment({ ...normalized, idempotencyKey: input.idempotencyKey }, actor, fingerprint);
    if (attachmentAssetIds.length) {
      await this.attachmentRepository!.attachCommentAttachments({ projectId: input.projectId, commentId: comment.id, assetIds: attachmentAssetIds, ownerUserId: actor.userId });
    }
    return (await this.decorateAttachments(await this.decorateDeletePermission([comment], actor)))[0]!;
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
    return (await this.decorateAttachments(await this.decorateDeletePermission([deleted], actor)))[0]!;
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

  /** 将内部 objectKey 转成短期 GET 地址；删除评论的附件不再向读者暴露。签名失败时保留元数据但不给出不可用 URL。 */
  private async decorateAttachments(comments: ProjectCommentSummary[]): Promise<ProjectCommentSummary[]> {
    if (!this.attachmentRepository || comments.length === 0) return comments.map((comment) => ({ ...comment, attachments: comment.attachments ?? [] }));
    const records = await this.attachmentRepository.listCommentAttachments(comments.map((comment) => comment.id));
    const grouped = new Map<string, CommentAttachmentRecord[]>();
    for (const record of records) grouped.set(record.commentId, [...(grouped.get(record.commentId) ?? []), record]);
    const summaries = await Promise.all(comments.map(async (comment) => {
      if (comment.deleted) return { ...comment, attachments: [] };
      const attachments = await Promise.all((grouped.get(comment.id) ?? []).map(async (record): Promise<CommentAttachmentSummary> => {
        if (!this.signAttachment) return { id: record.id, commentId: record.commentId, assetId: record.assetId, filename: record.filename, mimeType: record.mimeType, size: record.size, downloadUrl: null, expiresInSeconds: null };
        try {
          const grant = await this.signAttachment(record.objectKey);
          return { id: record.id, commentId: record.commentId, assetId: record.assetId, filename: record.filename, mimeType: record.mimeType, size: record.size, downloadUrl: grant.url, expiresInSeconds: grant.expiresInSeconds };
        } catch (error) {
          console.error("comment attachment signing failed", { commentId: comment.id, attachmentId: record.id, error });
          return { id: record.id, commentId: record.commentId, assetId: record.assetId, filename: record.filename, mimeType: record.mimeType, size: record.size, downloadUrl: null, expiresInSeconds: null };
        }
      }));
      return { ...comment, attachments };
    }));
    return summaries;
  }
}
