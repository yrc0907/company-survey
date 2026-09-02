import type { Sql, TransactionSql } from "postgres";

import type { KnowledgeCommandStore } from "@/lib/commands/knowledge/types";
import type { AuthenticatedActor } from "@/lib/domain/platform";
import type {
  BranchSummary,
  CollaborationSnapshot,
  CommitSummary,
  CreateBranchInput,
  CreateMergeRequestInput,
  CreateProjectInput,
  CreateReviewInput,
  MergeRequestSummary,
  ProjectSummary,
  ReviewSummary,
} from "@/lib/domain/collaboration";
import type { CommentAttachmentRepository, ProjectCommentRepository } from "@/lib/domain/collaboration";

/** 协作仓储接口；服务层只依赖这些原子操作，不直接拼接 SQL。 */
export interface CollaborationRepository extends ProjectCommentRepository, CommentAttachmentRepository {
  listPublicProjects(search?: string): Promise<ProjectSummary[]>;
  getProject(projectId: string): Promise<ProjectSummary | null>;
  createProject(input: CreateProjectInput, owner: AuthenticatedActor): Promise<ProjectSummary>;
  getBranch(branchId: string): Promise<BranchSummary | null>;
  listBranches(projectId: string): Promise<BranchSummary[]>;
  createBranch(input: CreateBranchInput, owner: AuthenticatedActor): Promise<BranchSummary>;
  createCommandStore(options: { branchId: string; expectedVersion?: number; idempotencyKey?: string; idempotencyFingerprint?: string; message?: string; aiAssisted?: boolean }): KnowledgeCommandStore;
  getCommitByIdempotency(branchId: string, idempotencyKey: string, idempotencyFingerprint?: string): Promise<CommitSummary | null>;
  getCommit(branchId: string, commitId: string): Promise<CommitSummary | null>;
  getSnapshot(branchId: string): Promise<CollaborationSnapshot>;
  createMergeRequest(input: CreateMergeRequestInput, actor: AuthenticatedActor): Promise<MergeRequestSummary>;
  listMergeRequests(projectId: string): Promise<MergeRequestSummary[]>;
  getMergeRequest(mergeRequestId: string): Promise<MergeRequestSummary | null>;
  listReviews(mergeRequestId: string): Promise<ReviewSummary[]>;
  addReview(input: CreateReviewInput, actor: AuthenticatedActor): Promise<ReviewSummary>;
  mergeMergeRequest(mergeRequestId: string, actor: AuthenticatedActor): Promise<MergeRequestSummary>;
  calculateMergeDiff(mergeRequestId: string): Promise<{ entries: import("@/lib/domain/collaboration").CollaborationDiffEntry[]; mergeRequest: MergeRequestSummary }>;
}

export type CollaborationQueryable = Sql | TransactionSql;
