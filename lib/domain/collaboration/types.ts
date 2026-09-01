import type { ChangeOperation, KnowledgeNodeKind, MergeRequestStatus, ReviewVerdict } from "@/lib/domain/platform/project";

/** 公开项目列表卡片的安全投影；不包含草稿、凭据或内部存储信息。 */
export interface ProjectSummary {
  id: string;
  ownerUserId: string;
  ownerUsername: string;
  ownerDisplayName: string;
  ownerAvatarAssetId: string | null;
  slug: string;
  title: string;
  summary: string;
  visibility: "private" | "public" | "unlisted";
  status: "draft" | "published" | "archived" | "suspended";
  license: string;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 协作领域中的简化节点快照；只用于 Diff/合并，不向模型或客户端暴露数据库行。 */
export interface CollaborationNodeSnapshot {
  nodeId: string;
  kind: KnowledgeNodeKind;
  parentNodeId: string | null;
  name: string;
  position: number;
  deleted: boolean;
  content: unknown | null;
  contentText: string;
  contentHash: string | null;
  revisionId: string | null;
}

export type CollaborationSnapshot = Record<string, CollaborationNodeSnapshot>;

export interface TextDiffHunk {
  type: "equal" | "add" | "remove";
  value: string;
}

export interface CollaborationConflict {
  nodeId: string;
  blockId?: string;
  reason: "text" | "tree" | "deleted" | "renamed" | "moved";
  base: string;
  source: string;
  target: string;
  hunks: TextDiffHunk[];
}

export interface CollaborationDiffEntry {
  nodeId: string;
  operation: ChangeOperation | "unchanged" | "conflict";
  base: CollaborationNodeSnapshot | null;
  source: CollaborationNodeSnapshot | null;
  target: CollaborationNodeSnapshot | null;
  conflicts: CollaborationConflict[];
}

export interface BranchSummary {
  id: string;
  projectId: string;
  name: string;
  ownerUserId: string | null;
  baseBranchId: string | null;
  baseCommitId: string | null;
  headCommitId: string | null;
  isProtected: boolean;
  status: "active" | "submitted" | "merged" | "closed";
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CommitSummary {
  id: string;
  projectId: string;
  branchId: string;
  parentCommitId: string | null;
  authorUserId: string;
  message: string;
  aiAssisted: boolean;
  idempotencyKey: string | null;
  createdAt: string;
}

export interface MergeRequestSummary {
  id: string;
  projectId: string;
  sourceBranchId: string;
  targetBranchId: string;
  authorUserId: string;
  title: string;
  description: string;
  status: MergeRequestStatus;
  baseCommitId: string | null;
  headCommitId: string | null;
  mergedCommitId: string | null;
  mergedByUserId: string | null;
  targetVersion: number;
  conflictStatus: "unknown" | "clean" | "conflict";
  conflictDetails: CollaborationConflict[];
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
}

export interface ReviewSummary {
  id: string;
  mergeRequestId: string;
  reviewerUserId: string;
  verdict: ReviewVerdict;
  body: string;
  nodeId: string | null;
  blockId: string | null;
  createdAt: string;
}

export interface CreateProjectInput {
  title: string;
  slug: string;
  summary?: string;
  visibility?: "private" | "public" | "unlisted";
  license?: string;
}

export interface CreateBranchInput {
  projectId: string;
  name?: string;
  baseBranchId?: string;
}

export interface ExecuteCommandInput {
  branchId: string;
  command: import("@/lib/commands/knowledge/types").KnowledgeCommand;
  message?: string;
  aiAssisted?: boolean;
  idempotencyKey?: string;
  expectedVersion?: number;
}

export interface CreateMergeRequestInput {
  projectId: string;
  sourceBranchId: string;
  targetBranchId: string;
  title: string;
  description?: string;
  idempotencyKey?: string;
}

export interface CreateReviewInput {
  mergeRequestId: string;
  verdict: ReviewVerdict;
  body?: string;
  nodeId?: string;
  blockId?: string;
  idempotencyKey?: string;
}
