import assert from "node:assert/strict";

import { GET as getComments, POST as postComment } from "@/app/api/platform/projects/[id]/comments/route";
import { DELETE as deleteComment } from "@/app/api/platform/projects/[id]/comments/[commentId]/route";
import { setAuthenticatedActorResolverForTest } from "@/lib/auth/session";
import { setCollaborationRepositoryForTest } from "@/lib/repositories/collaboration";
import { setPlatformRepositoryForTest } from "@/lib/repositories/platform/platform-repository-factory";
import type { CollaborationRepository } from "@/lib/repositories/collaboration/collaboration-repository";
import type { CreateProjectCommentInput, ProjectCommentSummary } from "@/lib/domain/collaboration";
import type { AuthenticatedActor } from "@/lib/domain/platform";

const project = { id: "project-1", ownerUserId: "owner-1", ownerUsername: "owner", ownerDisplayName: "项目维护者", ownerAvatarAssetId: null, slug: "project-1", title: "公开项目", summary: "", visibility: "public" as const, status: "published" as const, license: "CC-BY-4.0", publishedAt: "2026-09-01T00:00:00.000Z", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" };
const actor = { userId: "alice-1", role: "user" as const };

function createFakeRepository(): CollaborationRepository {
  const comments = new Map<string, ProjectCommentSummary>();
  const idempotency = new Map<string, string>();
  let number = 0;
  const withDelete = (comment: ProjectCommentSummary): ProjectCommentSummary => ({ ...comment, canDelete: comment.authorUserId === actor.userId });
  return {
    listPublicProjects: async () => [project], getProject: async () => project, createProject: async () => project,
    getBranch: async () => null, listBranches: async () => [], createBranch: async () => { throw new Error("not used"); },
    createCommandStore: () => { throw new Error("not used"); }, getCommitByIdempotency: async () => null, getCommit: async () => null, getSnapshot: async () => ({}),
    createMergeRequest: async () => { throw new Error("not used"); }, listMergeRequests: async () => [], getMergeRequest: async () => null, listReviews: async () => [], addReview: async () => { throw new Error("not used"); }, mergeMergeRequest: async () => { throw new Error("not used"); }, calculateMergeDiff: async () => ({ entries: [], mergeRequest: null as never }),
    listProjectComments: async (projectId: string) => Array.from(comments.values()).filter((comment) => comment.projectId === projectId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    getProjectComment: async (id: string) => comments.get(id) ?? null,
    getProjectCommentByIdempotency: async (projectId: string, authorUserId: string, key: string, fingerprint?: string) => {
      const id = idempotency.get(`${projectId}:${authorUserId}:${key}`);
      const found = id ? comments.get(id) : undefined;
      if (found && fingerprint && found.body !== fingerprint) return found;
      return found ?? null;
    },
    createProjectComment: async (input: CreateProjectCommentInput, author: AuthenticatedActor) => {
      const id = `comment-${++number}`;
      const value: ProjectCommentSummary = { id, projectId: input.projectId, parentId: input.parentId ?? null, authorUserId: author.userId, authorUsername: "alice", authorDisplayName: "Alice", authorAvatarAssetId: null, body: input.body, deleted: false, canDelete: true, createdAt: `2026-09-01T00:00:0${number}.000Z`, updatedAt: `2026-09-01T00:00:0${number}.000Z` };
      comments.set(id, value);
      if (input.idempotencyKey) idempotency.set(`${input.projectId}:${author.userId}:${input.idempotencyKey}`, id);
      return value;
    },
    softDeleteProjectComment: async (id: string) => {
      const current = comments.get(id);
      if (!current) throw new Error("not found");
      const value = { ...current, body: null, deleted: true, updatedAt: "2026-09-01T01:00:00.000Z" };
      comments.set(id, value);
      return value;
    },
  } as unknown as CollaborationRepository;
}

async function run(): Promise<void> {
  const repository = createFakeRepository();
  setCollaborationRepositoryForTest(repository);
  setPlatformRepositoryForTest({
    getProjectAccess: async (_projectId: string, userId: string | null) => ({ id: project.id, ownerUserId: project.ownerUserId, visibility: project.visibility, status: project.status, memberRole: userId === "owner-1" ? "owner" as const : null }),
  } as never);
  try {
    setAuthenticatedActorResolverForTest(async () => null);
    const anonymous = await getComments(new Request("http://localhost/api/platform/projects/project-1/comments"), { params: { id: project.id } });
    assert.equal(anonymous.status, 200, "匿名读取评论必须成功");
    setAuthenticatedActorResolverForTest(async () => actor);
    const first = await postComment(new Request("http://localhost/api/platform/projects/project-1/comments", { method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": "comment-key" }, body: JSON.stringify({ body: "第一条评论" }) }), { params: { id: project.id } });
    assert.equal(first.status, 201, "登录用户发布评论必须成功");
    const firstPayload = await first.json() as { comment: ProjectCommentSummary };
    assert.equal(firstPayload.comment.authorUserId, actor.userId, "作者必须来自 Session");
    const child = await postComment(new Request("http://localhost/api/platform/projects/project-1/comments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ parentId: firstPayload.comment.id, body: "回复评论" }) }), { params: { id: project.id } });
    assert.equal(child.status, 201, "同项目父评论回复必须成功");
    const repeated = await postComment(new Request("http://localhost/api/platform/projects/project-1/comments", { method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": "comment-key" }, body: JSON.stringify({ body: "第一条评论" }) }), { params: { id: project.id } });
    assert.equal((await repeated.json() as { comment: ProjectCommentSummary }).comment.id, firstPayload.comment.id, "幂等重试不得创建重复评论");
    const removed = await deleteComment(new Request("http://localhost/api/platform/projects/project-1/comments/comment-1", { method: "DELETE", headers: { "content-type": "application/json" } }), { params: { id: project.id, commentId: firstPayload.comment.id } });
    assert.equal(removed.status, 200, "作者软删除评论必须成功");
    assert.equal((await removed.json() as { comment: ProjectCommentSummary }).comment.deleted, true, "删除必须保留节点并标记 deleted");
    const listed = await getComments(new Request("http://localhost/api/platform/projects/project-1/comments"), { params: { id: project.id } });
    assert.equal((await listed.json() as { comments: ProjectCommentSummary[] }).comments.length, 2, "软删除不能删除子回复");
    setAuthenticatedActorResolverForTest(async () => null);
    const denied = await postComment(new Request("http://localhost/api/platform/projects/project-1/comments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body: "匿名写入" }) }), { params: { id: project.id } });
    assert.equal(denied.status, 401, "匿名写入必须要求登录");
    console.log("project comments contract: passed");
  } finally {
    setAuthenticatedActorResolverForTest(null); setCollaborationRepositoryForTest(null); setPlatformRepositoryForTest(null);
  }
}

void run().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
