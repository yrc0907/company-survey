import { ValidationError } from "@/lib/domain/errors";
import type { AuthorizedScope, ScopePermissionInput } from "@/lib/domain/memory";

/**
 * 将权限服务的判定收敛成不可扩大的 AI Scope。
 * 缺少资源 ID、身份或明确 grant 时一律拒绝，绝不降级到全站或其他项目。
 */
export function authorizeAiScope(input: ScopePermissionInput): AuthorizedScope {
  const base = {
    scope: input.scope,
    actorUserId: input.actor.userId,
    projectId: input.projectId ?? null,
    branchId: input.branchId ?? null,
    fileId: input.fileId ?? null,
    folderId: input.folderId ?? null,
    selectedText: input.selectedText?.trim() || null,
  };

  if (input.scope === "public") {
    if (!input.grants.publicRead) throw new ValidationError("无权读取公开知识范围");
    return { ...base, projectId: null, branchId: null, fileId: null, folderId: null, selectedText: null };
  }
  if (input.actor.kind !== "user" || !input.actor.userId) throw new ValidationError("该 AI 范围需要登录");
  if (!input.projectId || !input.grants.projectRead) throw new ValidationError("项目范围无法确认或无权读取");

  if (input.scope === "project") {
    if (input.branchId && !input.grants.branchRead) throw new ValidationError("无权读取当前分支");
    return base;
  }
  if (input.scope === "folder") {
    if (!input.folderId || !input.grants.folderRead) throw new ValidationError("文件夹范围无法确认或无权读取");
    return base;
  }
  if (input.scope === "file") {
    if (!input.fileId || !input.grants.fileRead) throw new ValidationError("文件范围无法确认或无权读取");
    return base;
  }
  if (!input.fileId || !input.grants.fileRead || !base.selectedText) {
    throw new ValidationError("选区范围必须包含可读文件和非空选区");
  }
  if (base.selectedText.length > 8_000) throw new ValidationError("选区不能超过 8000 个字符");
  return base;
}

