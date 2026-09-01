/** 文件树节点类型；原始资产与可编辑文档在领域层保持不同身份。 */
export type KnowledgeNodeKind = "folder" | "document" | "asset" | "source";

export interface KnowledgeNodeRecord {
  id: string;
  projectId: string;
  parentId: string | null;
  kind: KnowledgeNodeKind;
  name: string;
  deletedAt: string | null;
}

/** 所有写操作只能发生在本地游客草稿或服务器草稿，公开主分支永远只读。 */
export interface KnowledgeBranchContext {
  id: string;
  projectId: string;
  ownerId: string | null;
  storage: "local_guest" | "server_draft" | "published";
  status: "active" | "submitted" | "merged" | "closed";
}

export interface KnowledgeCommandActor {
  userId: string | null;
  localDraftId?: string;
}

export type KnowledgeCommand =
  | { type: "create_node"; parentId: string | null; kind: "folder" | "document"; name: string }
  | { type: "rename_node"; nodeId: string; name: string }
  | { type: "move_node"; nodeId: string; parentId: string | null }
  | { type: "delete_node"; nodeId: string }
  | { type: "restore_node"; nodeId: string }
  | { type: "duplicate_node"; nodeId: string; parentId: string | null; name?: string };

export interface KnowledgeTreeChange {
  id: string;
  projectId: string;
  branchId: string;
  actorId: string;
  command: KnowledgeCommand;
  before: KnowledgeNodeRecord | null;
  after: KnowledgeNodeRecord | null;
  createdAt: string;
}

export interface KnowledgeCommandResult {
  change: KnowledgeTreeChange;
  node: KnowledgeNodeRecord | null;
}

/** Repository 保证 appendChange 与树状态更新原子提交；具体 SQL/IndexedDB 实现可替换。 */
export interface KnowledgeCommandStore {
  getBranch(branchId: string): Promise<KnowledgeBranchContext | null>;
  getNode(branchId: string, nodeId: string): Promise<KnowledgeNodeRecord | null>;
  listChildren(branchId: string, parentId: string | null): Promise<KnowledgeNodeRecord[]>;
  isDescendant(branchId: string, possibleDescendantId: string, ancestorId: string): Promise<boolean>;
  appendChange(change: KnowledgeTreeChange): Promise<void>;
}

export interface KnowledgeCommandPermission {
  assertCanWrite(actor: KnowledgeCommandActor, branch: KnowledgeBranchContext): void;
}
