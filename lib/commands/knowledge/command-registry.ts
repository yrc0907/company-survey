import { randomUUID } from "node:crypto";

import { DefaultKnowledgeCommandPermission } from "@/lib/commands/knowledge/permission";
import type {
  KnowledgeBranchContext,
  KnowledgeCommand,
  KnowledgeCommandActor,
  KnowledgeCommandPermission,
  KnowledgeCommandResult,
  KnowledgeCommandStore,
  KnowledgeNodeRecord,
  KnowledgeTreeChange,
} from "@/lib/commands/knowledge/types";

const MAX_NODE_NAME_LENGTH = 160;

/** 规范化同级显示名称；稳定 ID 承担真实身份，名称只用于展示与路径。 */
function normalizeName(rawName: string): string {
  const name = rawName.replace(/\s+/g, " ").trim();
  if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\\") || name.includes("\0")) {
    throw new Error("文件或文件夹名称无效。" );
  }
  if (name.length > MAX_NODE_NAME_LENGTH) throw new Error(`名称不能超过 ${MAX_NODE_NAME_LENGTH} 个字符。`);
  return name;
}

/** 文件树的唯一写入口；UI、快捷键和 AI Patch 都必须调用同一 Registry。 */
export class KnowledgeCommandRegistry {
  public constructor(
    private readonly store: KnowledgeCommandStore,
    private readonly permission: KnowledgeCommandPermission = new DefaultKnowledgeCommandPermission(),
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly id: () => string = randomUUID,
  ) {}

  /** 验证权限和树不变量后，生成一条可进入 Commit/MR 的结构化变更。 */
  public async execute(branchId: string, actor: KnowledgeCommandActor, command: KnowledgeCommand): Promise<KnowledgeCommandResult> {
    const branch = await this.requireBranch(branchId);
    this.permission.assertCanWrite(actor, branch);
    const actorId = actor.userId ?? `guest:${actor.localDraftId}`;
    const result = await this.apply(branch, command);
    const change: KnowledgeTreeChange = {
      id: this.id(), projectId: branch.projectId, branchId: branch.id, actorId,
      command: result.command, before: result.before, after: result.after, createdAt: this.now(),
    };
    await this.store.appendChange(change);
    return { change, node: result.after };
  }

  private async apply(branch: KnowledgeBranchContext, command: KnowledgeCommand): Promise<{ command: KnowledgeCommand; before: KnowledgeNodeRecord | null; after: KnowledgeNodeRecord | null }> {
    switch (command.type) {
      case "create_node": {
        await this.assertParent(branch, command.parentId);
        const name = normalizeName(command.name);
        await this.assertSiblingNameAvailable(branch.id, command.parentId, name);
        const normalized = { ...command, name };
        return { command: normalized, before: null, after: { id: this.id(), projectId: branch.projectId, parentId: command.parentId, kind: command.kind, name, deletedAt: null } };
      }
      case "rename_node": {
        const before = await this.requireNode(branch, command.nodeId);
        const name = normalizeName(command.name);
        await this.assertSiblingNameAvailable(branch.id, before.parentId, name, before.id);
        return { command: { ...command, name }, before, after: { ...before, name } };
      }
      case "move_node": {
        const before = await this.requireNode(branch, command.nodeId);
        await this.assertParent(branch, command.parentId);
        if (command.parentId === before.id || (command.parentId && await this.store.isDescendant(branch.id, command.parentId, before.id))) {
          throw new Error("文件夹不能移动到自身或其子目录。" );
        }
        await this.assertSiblingNameAvailable(branch.id, command.parentId, before.name, before.id);
        return { command, before, after: { ...before, parentId: command.parentId } };
      }
      case "delete_node": {
        const before = await this.requireNode(branch, command.nodeId, true);
        if (before.deletedAt) throw new Error("节点已经在回收站中。" );
        return { command, before, after: { ...before, deletedAt: this.now() } };
      }
      case "restore_node": {
        const before = await this.requireNode(branch, command.nodeId, true);
        if (!before.deletedAt) throw new Error("节点不在回收站中。" );
        await this.assertSiblingNameAvailable(branch.id, before.parentId, before.name, before.id);
        return { command, before, after: { ...before, deletedAt: null } };
      }
      case "duplicate_node": {
        const source = await this.requireNode(branch, command.nodeId);
        if (source.kind === "folder") throw new Error("V1 暂不支持递归复制文件夹。" );
        await this.assertParent(branch, command.parentId);
        const name = normalizeName(command.name ?? `${source.name} 副本`);
        await this.assertSiblingNameAvailable(branch.id, command.parentId, name);
        return { command: { ...command, name }, before: source, after: { ...source, id: this.id(), parentId: command.parentId, name, deletedAt: null } };
      }
    }
  }

  private async requireBranch(branchId: string): Promise<KnowledgeBranchContext> {
    const branch = await this.store.getBranch(branchId);
    if (!branch) throw new Error("草稿分支不存在。" );
    return branch;
  }

  private async requireNode(branch: KnowledgeBranchContext, nodeId: string, allowDeleted = false): Promise<KnowledgeNodeRecord> {
    const node = await this.store.getNode(branch.id, nodeId);
    if (!node || node.projectId !== branch.projectId || (!allowDeleted && node.deletedAt)) throw new Error("文件树节点不存在。" );
    return node;
  }

  private async assertParent(branch: KnowledgeBranchContext, parentId: string | null): Promise<void> {
    if (!parentId) return;
    const parent = await this.requireNode(branch, parentId);
    if (parent.kind !== "folder") throw new Error("只能在文件夹中创建或移动节点。" );
  }

  private async assertSiblingNameAvailable(branchId: string, parentId: string | null, name: string, ignoredNodeId?: string): Promise<void> {
    const normalized = name.toLocaleLowerCase("zh-CN");
    const siblings = await this.store.listChildren(branchId, parentId);
    if (siblings.some((item) => item.id !== ignoredNodeId && !item.deletedAt && item.name.toLocaleLowerCase("zh-CN") === normalized)) {
      throw new Error("同一文件夹内已存在同名节点。" );
    }
  }
}
