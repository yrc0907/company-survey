import type { KnowledgeBranchContext, KnowledgeCommandStore, KnowledgeNodeRecord, KnowledgeTreeChange } from "@/lib/commands/knowledge/types";

/** 仅用于契约测试和游客 IndexedDB adapter 的行为参考，不用于生产持久化。 */
export class MemoryKnowledgeCommandStore implements KnowledgeCommandStore {
  public readonly changes: KnowledgeTreeChange[] = [];

  public constructor(
    private readonly branches: Map<string, KnowledgeBranchContext>,
    private readonly nodesByBranch: Map<string, Map<string, KnowledgeNodeRecord>>,
  ) {}

  public async getBranch(branchId: string): Promise<KnowledgeBranchContext | null> {
    return structuredClone(this.branches.get(branchId) ?? null);
  }

  public async getNode(branchId: string, nodeId: string): Promise<KnowledgeNodeRecord | null> {
    return structuredClone(this.nodesByBranch.get(branchId)?.get(nodeId) ?? null);
  }

  public async listChildren(branchId: string, parentId: string | null): Promise<KnowledgeNodeRecord[]> {
    return [...(this.nodesByBranch.get(branchId)?.values() ?? [])].filter((node) => node.parentId === parentId).map((node) => structuredClone(node));
  }

  public async isDescendant(branchId: string, possibleDescendantId: string, ancestorId: string): Promise<boolean> {
    const nodes = this.nodesByBranch.get(branchId);
    let current = nodes?.get(possibleDescendantId);
    const visited = new Set<string>();
    while (current?.parentId) {
      if (current.parentId === ancestorId) return true;
      if (visited.has(current.parentId)) throw new Error("文件树存在循环引用。" );
      visited.add(current.parentId);
      current = nodes?.get(current.parentId);
    }
    return false;
  }

  /** 模拟数据库事务：变更日志与最新节点快照同时落地。 */
  public async appendChange(change: KnowledgeTreeChange): Promise<void> {
    const nodes = this.nodesByBranch.get(change.branchId);
    if (!nodes) throw new Error("分支存储不存在。" );
    this.changes.push(structuredClone(change));
    if (change.after) nodes.set(change.after.id, structuredClone(change.after));
  }
}
