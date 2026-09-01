import assert from "node:assert/strict";

import { calculateDiff, type BranchSummary, type CollaborationSnapshot, type MergeRequestSummary, type ProjectSummary, type ReviewSummary } from "@/lib/domain/collaboration";
import { CollaborationService } from "@/lib/services/collaboration/collaboration-service";
import type { CollaborationRepository } from "@/lib/repositories/collaboration/collaboration-repository";
import type { PlatformRepository } from "@/lib/repositories/platform/platform-repository";

const actor = { userId: "alice", role: "user" as const };
const reviewer = { userId: "maintainer", role: "user" as const };
const project: ProjectSummary = { id: "p1", ownerUserId: "alice", ownerUsername: "alice", ownerDisplayName: "Alice", ownerAvatarAssetId: null, slug: "demo", title: "Demo", summary: "", visibility: "public", status: "published", license: "CC-BY-4.0", publishedAt: "2026-09-01T00:00:00.000Z", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" };
const branch = (id: string, ownerUserId: string | null, isProtected: boolean): BranchSummary => ({ id, projectId: "p1", name: id, ownerUserId, baseBranchId: isProtected ? null : "main", baseCommitId: "c0", headCommitId: "c1", isProtected, status: "active", version: 1, createdAt: project.createdAt, updatedAt: project.updatedAt });

/** 仅验证协作服务的授权/幂等边界；生产仓储由 PostgreSQL 实现，测试不连接外部服务。 */
async function run(): Promise<void> {
  const mrs = new Map<string, MergeRequestSummary>(); const reviews = new Map<string, ReviewSummary[]>(); let reviewNumber = 0;
  const fakeRepository = {
    listPublicProjects: async () => [project], getProject: async () => project, createProject: async () => project,
    getBranch: async (id: string) => id === "main" ? branch("main", null, true) : id === "alice-draft" ? branch("alice-draft", "alice", false) : null,
    listBranches: async () => [branch("main", null, true), branch("alice-draft", "alice", false)], createBranch: async () => branch("new", "alice", false),
    createCommandStore: () => { throw new Error("命令持久化在本契约中不执行"); }, getCommitByIdempotency: async () => null, getCommit: async () => null,
    getSnapshot: async () => ({}), calculateMergeDiff: async () => { throw new Error("not used"); },
    createMergeRequest: async (input: { idempotencyKey?: string; sourceBranchId: string; targetBranchId: string; projectId: string; title: string; description?: string }, owner: typeof actor) => {
      const prior = input.idempotencyKey ? Array.from(mrs.values()).find((item) => item.sourceBranchId === input.sourceBranchId && item.targetBranchId === input.targetBranchId && item.authorUserId === owner.userId) : undefined;
      if (prior) return prior;
      const value: MergeRequestSummary = { id: `mr-${mrs.size + 1}`, projectId: input.projectId, sourceBranchId: input.sourceBranchId, targetBranchId: input.targetBranchId, authorUserId: owner.userId, title: input.title, description: input.description ?? "", status: "open", baseCommitId: "c0", headCommitId: "c1", mergedCommitId: null, mergedByUserId: null, targetVersion: 1, conflictStatus: "unknown", conflictDetails: [], createdAt: project.createdAt, updatedAt: project.updatedAt, mergedAt: null };
      mrs.set(value.id, value); return value;
    },
    getMergeRequest: async (id: string) => mrs.get(id) ?? null, listReviews: async (id: string) => reviews.get(id) ?? [],
    addReview: async (input: { mergeRequestId: string; verdict: ReviewSummary["verdict"]; body?: string; nodeId?: string; blockId?: string }, actorInput: typeof reviewer) => { const value: ReviewSummary = { id: `review-${++reviewNumber}`, mergeRequestId: input.mergeRequestId, reviewerUserId: actorInput.userId, verdict: input.verdict, body: input.body ?? "", nodeId: input.nodeId ?? null, blockId: input.blockId ?? null, createdAt: project.createdAt }; const list = reviews.get(input.mergeRequestId) ?? []; list.push(value); reviews.set(input.mergeRequestId, list); return value; },
    mergeMergeRequest: async () => { throw new Error("not used"); },
  } as unknown as CollaborationRepository;
  const platform = {
    getProjectAccess: async (_id: string, userId: string | null) => ({ id: "p1", ownerUserId: "alice", visibility: "public" as const, status: "published" as const, memberRole: userId === "maintainer" ? "maintainer" as const : null }),
    getBranchAccess: async (_projectId: string, branchId: string) => ({ id: branchId, projectId: "p1", ownerUserId: branchId === "alice-draft" ? "alice" : null, isProtected: branchId === "main" }),
  } as unknown as PlatformRepository;
  const service = new CollaborationService(fakeRepository, platform);
  const input = { projectId: "p1", sourceBranchId: "alice-draft", targetBranchId: "main", title: "补充数据", idempotencyKey: "same-request" };
  const first = await service.createMergeRequest(input, actor); const second = await service.createMergeRequest(input, actor); assert.equal(first.id, second.id, "重复 MR 请求必须幂等");
  await assert.rejects(() => service.addReview({ mergeRequestId: first.id, verdict: "approve" }, actor), /提交者不能审核/);
  const review = await service.addReview({ mergeRequestId: first.id, verdict: "approve", nodeId: "doc-1", blockId: "b-1" }, reviewer); assert.equal(review.verdict, "approve");

  const base: CollaborationSnapshot = { doc: { nodeId: "doc", kind: "document", parentNodeId: null, name: "报告", position: 0, deleted: false, content: {}, contentText: "规模为 10", contentHash: "base", revisionId: "r0" } };
  const source = { ...base, doc: { ...base.doc!, contentText: "规模为 20", contentHash: "source" } }; const target = { ...base, doc: { ...base.doc!, contentText: "规模为 30", contentHash: "target" } };
  const conflict = calculateDiff(base, source, target); assert.equal(conflict[0]?.operation, "conflict", "双方修改同一文本必须产生冲突"); assert.ok(conflict[0]?.conflicts[0]?.hunks.length);
  const clean = calculateDiff(base, source, base); assert.equal(clean[0]?.operation, "update_content", "只有源分支修改时应可自动合并");
  console.log("collaboration contract: passed");
}

void run().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
