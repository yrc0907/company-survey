import type { AuthenticatedActor } from "@/lib/domain/platform";

/** 项目级评论的公开安全投影；已删除评论保留作者和时间，但正文为空。 */
export interface ProjectCommentSummary {
  id: string;
  projectId: string;
  parentId: string | null;
  /** 可选的文件/段落锚点；为空表示项目级评论。 */
  nodeId?: string | null;
  blockId?: string | null;
  quote?: string | null;
  authorUserId: string;
  authorUsername: string;
  authorDisplayName: string;
  authorAvatarAssetId: string | null;
  body: string | null;
  deleted: boolean;
  canDelete: boolean;
  createdAt: string;
  updatedAt: string;
}

/** 创建项目评论；身份由服务端 actor 提供，输入不能携带 authorUserId。 */
export interface CreateProjectCommentInput {
  projectId: string;
  parentId?: string | null;
  nodeId?: string | null;
  blockId?: string | null;
  quote?: string | null;
  body: string;
  idempotencyKey?: string;
}

/** 评论仓储的最小接口；具体 SQL、事务和用户资料投影留在 repository 层。 */
export interface ProjectCommentRepository {
  listProjectComments(projectId: string): Promise<ProjectCommentSummary[]>;
  getProjectComment(commentId: string): Promise<ProjectCommentSummary | null>;
  getProjectCommentByIdempotency(projectId: string, authorUserId: string, idempotencyKey: string, fingerprint?: string): Promise<ProjectCommentSummary | null>;
  createProjectComment(input: CreateProjectCommentInput, actor: AuthenticatedActor, fingerprint?: string): Promise<ProjectCommentSummary>;
  softDeleteProjectComment(commentId: string, actor: AuthenticatedActor): Promise<ProjectCommentSummary>;
}
