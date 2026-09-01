import { authErrorResponse } from "@/lib/auth/api-response";
import { requireAuthenticatedActor } from "@/lib/auth/session";
import { NotFoundError } from "@/lib/domain/errors";
import type { KnowledgeNodeKind } from "@/lib/domain/platform";
import { json } from "@/lib/api/http";
import { getPlatformRepository } from "@/lib/repositories/platform/platform-repository-factory";
import { getCollaborationRepository } from "@/lib/repositories/collaboration";
import { AuthorizationService } from "@/lib/services/platform/authorization-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fileKind(kind: KnowledgeNodeKind): "folder" | "document" | "source" | "data" {
  if (kind === "folder" || kind === "source" || kind === "data") return kind;
  return "document";
}

/**
 * 私有项目详情只接受当前 Session 的 owner；文件树来自允许分支快照，
 * 不接受 query/body 中的 userId。跨用户和不存在项目都返回同一个 404，避免枚举私有项目。
 */
export async function GET(_request: Request, context: { params: { id: string } }) {
  try {
    const actor = await requireAuthenticatedActor();
    const projectId = context.params.id.trim();
    if (!projectId) throw new NotFoundError("私有项目不存在");
    const platformRepository = getPlatformRepository();
    const access = await platformRepository.getProjectAccess(projectId, actor.userId);
    if (!access || access.ownerUserId !== actor.userId) throw new NotFoundError("私有项目不存在");
    await new AuthorizationService(platformRepository).assertProjectAction(actor, projectId, "read_draft");

    const collaborationRepository = getCollaborationRepository();
    const project = await collaborationRepository.getProject(projectId);
    if (!project || project.ownerUserId !== actor.userId || project.status === "suspended") throw new NotFoundError("私有项目不存在");
    const branches = await collaborationRepository.listBranches(projectId);
    const branch = branches
      .filter((candidate) => candidate.ownerUserId === actor.userId || candidate.isProtected)
      // 上传资料先写入 owner 的草稿分支；只有没有草稿时才读取保护主分支。
      .sort((left, right) => Number(right.ownerUserId === actor.userId) - Number(left.ownerUserId === actor.userId) || Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
    const snapshot = branch ? await collaborationRepository.getSnapshot(branch.id) : {};
    const nodes = Object.values(snapshot).filter((node) => !node.deleted);
    const files = nodes.map((node) => ({ id: node.nodeId, name: node.name, kind: fileKind(node.kind), parentId: node.parentNodeId, position: node.position }));
    const sections = nodes.filter((node) => node.kind === "document" || node.kind === "markdown").map((node) => ({
      id: `section-${node.nodeId}`, nodeId: node.nodeId, heading: node.name, content: node.contentText,
      evidenceState: "needs_verification" as const, updatedAt: branch?.updatedAt ?? project.updatedAt,
    }));
    const owner = { id: project.ownerUserId, username: project.ownerUsername, displayName: project.ownerDisplayName, avatarAssetId: project.ownerAvatarAssetId };
    return json({
      project: {
        id: project.id, slug: project.slug, title: project.title, summary: project.summary,
        visibility: project.visibility, status: project.status, license: project.license, owner,
        publishedAt: project.publishedAt, updatedAt: project.updatedAt, uniqueReaders: 0, starCount: 0,
        contributorCount: 1, sourceCount: nodes.filter((node) => node.kind === "source").length, openMergeRequests: 0,
        version: Math.max(1, (branch?.version ?? 0) + 1), verification: "needs_verification", verificationNote: "这是你的私有草稿，公开前需要完成来源核验。",
        files, sections,
      },
      source: "postgres_private",
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
