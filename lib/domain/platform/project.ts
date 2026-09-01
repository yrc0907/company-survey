export type ProjectVisibility = "private" | "public" | "unlisted";
export type ProjectStatus = "draft" | "published" | "archived" | "suspended";
export type ProjectMemberRole = "owner" | "maintainer" | "contributor";
export type KnowledgeNodeKind = "folder" | "document" | "markdown" | "source" | "data";
export type ChangeOperation = "create_node" | "update_content" | "rename_node" | "move_node" | "delete_node" | "restore_node" | "duplicate_node";
export type MergeRequestStatus = "draft" | "open" | "changes_requested" | "approved" | "merged" | "closed";
export type ReviewVerdict = "comment" | "approve" | "request_changes" | "reject";

/** 公开知识项目的权限判断投影；不携带正文或私有草稿。 */
export interface KnowledgeProjectAccess {
  id: string;
  ownerUserId: string;
  visibility: ProjectVisibility;
  status: ProjectStatus;
  memberRole: ProjectMemberRole | null;
}

/** 项目成员关系是项目级授权的唯一事实来源。 */
export interface ProjectMembership {
  projectId: string;
  userId: string;
  role: ProjectMemberRole;
  createdAt: string;
}

/** 文件树节点使用稳定 ID；移动、改名与内容修订不改变节点身份。 */
export interface KnowledgeNode {
  id: string;
  projectId: string;
  kind: KnowledgeNodeKind;
  createdByUserId: string;
  createdAt: string;
}

/**
 * 单个分支上的文件树状态。重命名、移动、排序和软删除只产生该分支的新状态，
 * 不修改 KnowledgeNode 稳定身份，也不会污染 main 或其他贡献者分支。
 */
export interface KnowledgeNodeState {
  projectId: string;
  branchId: string;
  nodeId: string;
  parentNodeId: string | null;
  name: string;
  position: number;
  deletedAt: string | null;
  updatedAt: string;
}

/** 分支授权投影；受保护分支不接受普通 write_branch 命令，只能走审核合并事务。 */
export interface KnowledgeBranchAccess {
  id: string;
  projectId: string;
  ownerUserId: string | null;
  isProtected: boolean;
}

/** 不可变内容版本，正式事实通过分支与 Commit 定位。 */
export interface DocumentRevision {
  id: string;
  projectId: string;
  nodeId: string;
  branchId: string;
  commitId: string;
  previousRevisionId: string | null;
  content: unknown;
  contentText: string;
  contentHash: string;
  createdByUserId: string;
  createdAt: string;
}

/** 一个原子提交下的节点操作，用于 Diff、审计和冲突检查。 */
export interface CommitChange {
  id: string;
  commitId: string;
  nodeId: string;
  operation: ChangeOperation;
  beforeRevisionId: string | null;
  afterRevisionId: string | null;
  metadata: Record<string, unknown>;
  position: number;
}
