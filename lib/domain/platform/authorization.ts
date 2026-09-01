import type { PlatformRole } from "@/lib/domain/platform/identity";
import type { KnowledgeBranchAccess, KnowledgeProjectAccess, ProjectMemberRole } from "@/lib/domain/platform/project";

export type ProjectAction =
  | "read_published"
  | "read_draft"
  | "create_branch"
  | "write_branch"
  | "submit_merge_request"
  | "review_merge_request"
  | "merge"
  | "manage_project";

const ROLE_ACTIONS: Readonly<Record<ProjectMemberRole, ReadonlySet<ProjectAction>>> = {
  contributor: new Set<ProjectAction>(["read_published", "read_draft", "create_branch", "write_branch", "submit_merge_request"]),
  maintainer: new Set<ProjectAction>(["read_published", "read_draft", "create_branch", "write_branch", "submit_merge_request", "review_merge_request", "merge"]),
  owner: new Set<ProjectAction>(["read_published", "read_draft", "create_branch", "write_branch", "submit_merge_request", "review_merge_request", "merge", "manage_project"]),
};

/**
 * 纯权限函数，输入为服务端 actor 与项目访问投影，输出是否允许。
 * 无副作用；未能解析项目或身份时默认拒绝，避免跨项目回退。
 */
export function canPerformProjectAction(
  actor: { userId: string; role: PlatformRole } | null,
  project: KnowledgeProjectAccess | null,
  action: ProjectAction,
): boolean {
  if (!project) return false;
  if (action === "read_published" && project.visibility === "public" && project.status === "published") return true;
  if (!actor || project.status === "suspended") return false;
  // 平台管理员只负责治理，不自动获得项目正文写入、审核或合并权。
  // 若管理员参与项目，仍必须拥有显式项目成员角色。
  if (project.ownerUserId === actor.userId) return ROLE_ACTIONS.owner.has(action);
  return project.memberRole ? ROLE_ACTIONS[project.memberRole].has(action) : false;
}

/**
 * 分支级授权在项目权限之上进一步限制草稿读写。
 * 普通贡献者只能读写自己的非保护分支；维护者可读取所有草稿，但保护分支仍只能通过 merge 写入。
 */
export function canPerformBranchAction(
  actor: { userId: string; role: PlatformRole } | null,
  project: KnowledgeProjectAccess | null,
  branch: KnowledgeBranchAccess | null,
  action: Extract<ProjectAction, "read_draft" | "write_branch" | "submit_merge_request">,
): boolean {
  if (!actor || !project || !branch || branch.projectId !== project.id || project.status === "suspended") return false;
  if (!canPerformProjectAction(actor, project, action)) return false;
  const projectRole = project.ownerUserId === actor.userId ? "owner" : project.memberRole;
  if (action === "read_draft") return branch.ownerUserId === actor.userId || projectRole === "owner" || projectRole === "maintainer";
  // submitted/merged/closed 分支是不可继续写入的历史；即使仍是 owner 也必须新建分支。
  if (branch.status !== "active") return false;
  if (branch.isProtected) return false;
  if (action === "write_branch") return branch.ownerUserId === actor.userId || projectRole === "owner" || projectRole === "maintainer";
  return branch.ownerUserId === actor.userId || projectRole === "owner" || projectRole === "maintainer";
}
