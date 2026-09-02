import assert from "node:assert/strict";

import { GET as getComments, POST as postComment } from "@/app/api/platform/projects/[id]/comments/route";
import { DELETE as deleteComment } from "@/app/api/platform/projects/[id]/comments/[commentId]/route";
import { setAuthenticatedActorResolverForTest } from "@/lib/auth/session";
import { setCollaborationRepositoryForTest } from "@/lib/repositories/collaboration";
import { setPlatformRepositoryForTest } from "@/lib/repositories/platform/platform-repository-factory";
import type { CollaborationRepository } from "@/lib/repositories/collaboration/collaboration-repository";
import type { CommentAttachmentRecord, CreateProjectCommentInput, ProjectCommentSummary } from "@/lib/domain/collaboration";
import type { AuthenticatedActor } from "@/lib/domain/platform";
import { getOssConfig, OssObjectStorageProvider } from "@/lib/providers/oss";
import { setAssetsOssProviderForTest } from "@/lib/services/assets/oss-provider-factory";

const project = { id: "project-1", ownerUserId: "owner-1", ownerUsername: "owner", ownerDisplayName: "项目维护者", ownerAvatarAssetId: null, slug: "project-1", title: "公开项目", summary: "", visibility: "public" as const, status: "published" as const, license: "CC-BY-4.0", publishedAt: "2026-09-01T00:00:00.000Z", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" };
const actor = { userId: "alice-1", role: "user" as const };

function createFakeRepository(): CollaborationRepository {
  const comments = new Map<string, ProjectCommentSummary>();
  const attachments: CommentAttachmentRecord[] = [];
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
    listCommentAttachments: async (commentIds: string[]) => attachments.filter((item) => commentIds.includes(item.commentId)),
    attachCommentAttachments: async (input: { projectId: string; commentId: string; assetIds: string[]; ownerUserId: string }) => {
      if (input.assetIds.some((assetId) => assetId !== "asset-image-1")) throw new Error("附件不存在、未完成校验或不属于当前用户");
      for (let position = 0; position < input.assetIds.length; position += 1) {
        const assetId = input.assetIds[position]!;
        if (!attachments.some((item) => item.commentId === input.commentId && item.assetId === assetId)) attachments.push({ id: `attachment-${attachments.length + 1}`, commentId: input.commentId, assetId, filename: "evidence.gif", mimeType: "image/gif", size: 128, objectKey: `quarantine/${input.ownerUserId}/upload-1/${"a".repeat(64)}.gif` });
      }
      return attachments.filter((item) => item.commentId === input.commentId);
    },
  } as unknown as CollaborationRepository;
}

async function run(): Promise<void> {
  const repository = createFakeRepository();
  setCollaborationRepositoryForTest(repository);
  setPlatformRepositoryForTest({
    getProjectAccess: async (_projectId: string, userId: string | null) => ({ id: project.id, ownerUserId: project.ownerUserId, visibility: project.visibility, status: project.status, memberRole: userId === "owner-1" ? "owner" as const : null }),
  } as never);
  const config = getOssConfig({ OSS_AUTH_MODE: "ecs_ram_role", OSS_RAM_ROLE_NAME: "research-oss", OSS_BUCKET: "reaserch", OSS_REGION: "cn-shanghai", OSS_ENDPOINT: "https://oss-cn-shanghai.aliyuncs.com" });
  if (!config.configured) throw new Error(config.reason);
  setAssetsOssProviderForTest(new OssObjectStorageProvider(config.value, { asyncSignatureUrl: async (name) => `https://signed.test/${encodeURIComponent(name)}` }));
  try {
    setAuthenticatedActorResolverForTest(async () => null);
    const anonymous = await getComments(new Request("http://localhost/api/platform/projects/project-1/comments"), { params: { id: project.id } });
    assert.equal(anonymous.status, 200, "匿名读取评论必须成功");
    setAuthenticatedActorResolverForTest(async () => actor);
    const incompleteAnchor = await postComment(new Request("http://localhost/api/platform/projects/project-1/comments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nodeId: "node-1", body: "缺少段落锚点" }) }), { params: { id: project.id } });
    assert.equal(incompleteAnchor.status, 400, "段落评论必须同时提交文件、段落和引用片段");
    const first = await postComment(new Request("http://localhost/api/platform/projects/project-1/comments", { method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": "comment-key" }, body: JSON.stringify({ body: "第一条评论" }) }), { params: { id: project.id } });
    assert.equal(first.status, 201, "登录用户发布评论必须成功");
    const firstPayload = await first.json() as { comment: ProjectCommentSummary };
    assert.equal(firstPayload.comment.authorUserId, actor.userId, "作者必须来自 Session");
    const withAttachment = await postComment(new Request("http://localhost/api/platform/projects/project-1/comments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body: "带 GIF 证据", attachmentAssetIds: ["asset-image-1"] }) }), { params: { id: project.id } });
    assert.equal(withAttachment.status, 201, "登录用户绑定已校验图片附件必须成功");
    const attachmentPayload = await withAttachment.json() as { comment: ProjectCommentSummary };
    assert.equal(attachmentPayload.comment.attachments?.[0]?.mimeType, "image/gif", "评论响应必须返回附件元数据");
    assert.match(attachmentPayload.comment.attachments?.[0]?.downloadUrl ?? "", /^https:\/\/signed\.test\//, "附件不能返回 OSS 原始 Key，必须是短期签名地址");
    const child = await postComment(new Request("http://localhost/api/platform/projects/project-1/comments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ parentId: firstPayload.comment.id, body: "回复评论" }) }), { params: { id: project.id } });
    assert.equal(child.status, 201, "同项目父评论回复必须成功");
    const repeated = await postComment(new Request("http://localhost/api/platform/projects/project-1/comments", { method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": "comment-key" }, body: JSON.stringify({ body: "第一条评论" }) }), { params: { id: project.id } });
    assert.equal((await repeated.json() as { comment: ProjectCommentSummary }).comment.id, firstPayload.comment.id, "幂等重试不得创建重复评论");
    const removed = await deleteComment(new Request("http://localhost/api/platform/projects/project-1/comments/comment-1", { method: "DELETE", headers: { "content-type": "application/json" } }), { params: { id: project.id, commentId: firstPayload.comment.id } });
    assert.equal(removed.status, 200, "作者软删除评论必须成功");
    assert.equal((await removed.json() as { comment: ProjectCommentSummary }).comment.deleted, true, "删除必须保留节点并标记 deleted");
    const listed = await getComments(new Request("http://localhost/api/platform/projects/project-1/comments"), { params: { id: project.id } });
    assert.equal((await listed.json() as { comments: ProjectCommentSummary[] }).comments.length, 3, "软删除不能删除子回复");
    const listedWithAttachment = await getComments(new Request("http://localhost/api/platform/projects/project-1/comments"), { params: { id: project.id } });
    const listedAttachment = (await listedWithAttachment.json() as { comments: ProjectCommentSummary[] }).comments.find((item) => item.id === attachmentPayload.comment.id);
    assert.match(listedAttachment?.attachments?.[0]?.downloadUrl ?? "", /^https:\/\/signed\.test\//, "匿名读取公开评论附件必须重新签发短期 URL");
    setAuthenticatedActorResolverForTest(async () => null);
    const denied = await postComment(new Request("http://localhost/api/platform/projects/project-1/comments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body: "匿名写入" }) }), { params: { id: project.id } });
    assert.equal(denied.status, 401, "匿名写入必须要求登录");
    console.log("project comments contract: passed");
  } finally {
    setAuthenticatedActorResolverForTest(null); setCollaborationRepositoryForTest(null); setPlatformRepositoryForTest(null); setAssetsOssProviderForTest(null);
  }
}

void run().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
