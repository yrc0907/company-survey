/** AI 可读取的资源范围；每次请求只能选择其中一个明确范围。 */
export type AiScope = "selection" | "file" | "folder" | "project" | "public";

/** 请求主体；匿名主体没有 userId，不能访问私人会话、草稿或长期记忆。 */
export interface MemoryActor {
  kind: "anonymous" | "user";
  userId: string | null;
}

/** 权限服务给上下文层的已判定授权，缺少任一必要授权时必须拒绝。 */
export interface ScopePermissionInput {
  actor: MemoryActor;
  scope: AiScope;
  projectId?: string;
  branchId?: string;
  fileId?: string;
  folderId?: string;
  selectedText?: string;
  grants: {
    publicRead: boolean;
    projectRead: boolean;
    branchRead: boolean;
    fileRead: boolean;
    folderRead: boolean;
  };
}

/** 通过 fail-closed 校验后才能用于查询的范围。 */
export interface AuthorizedScope {
  scope: AiScope;
  actorUserId: string | null;
  projectId: string | null;
  branchId: string | null;
  fileId: string | null;
  folderId: string | null;
  selectedText: string | null;
}

export type ConversationStatus = "active" | "archived" | "deleted";
export type ConversationRole = "user" | "assistant" | "system" | "tool";

/** 私人 AI 会话；project/branch 仅是作用域，不会授予访问权限。 */
export interface Conversation {
  id: string;
  ownerUserId: string;
  projectId: string | null;
  branchId: string | null;
  parentConversationId: string | null;
  parentMessageId: string | null;
  title: string;
  status: ConversationStatus;
  pinned: boolean;
  summaryVersion: number;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
}

/** 原始消息为追加写事件；修改或重试必须创建新消息。 */
export interface ConversationMessage {
  id: string;
  conversationId: string;
  sequence: number;
  role: ConversationRole;
  content: string;
  tokenEstimate: number;
  parentMessageId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

/** 工具执行显式关联 call/result，压缩区间不得拆开这一对。 */
export interface ToolExecution {
  id: string;
  conversationId: string;
  callMessageId: string;
  resultMessageId: string | null;
  toolName: string;
  argumentsHash: string;
  status: "requested" | "completed" | "failed" | "cancelled";
  resultReference: string | null;
  createdAt: string;
  completedAt: string | null;
}

/** 可验证的结构化摘要，禁止用一段自由文本替代关键状态。 */
export interface StructuredConversationSummary {
  goal: string[];
  decisions: string[];
  constraints: string[];
  entities: Array<{ id: string; name: string; kind: string }>;
  claims: Array<{ id: string; text: string; state: "fact" | "inference" | "needs_verification" | "conflict" }>;
  citationIds: string[];
  todos: Array<{ id: string; text: string; status: "open" | "done" | "blocked" }>;
  conflicts: Array<{ id: string; description: string }>;
}

export interface ConversationSummary {
  id: string;
  conversationId: string;
  version: number;
  structured: StructuredConversationSummary;
  sourceStartSequence: number;
  sourceEndSequence: number;
  sourceMessageIds: string[];
  provider: string;
  model: string;
  createdAt: string;
}

/** 压缩事务状态；failed 检查点不能被当作可恢复摘要。 */
export interface ConversationCheckpoint {
  id: string;
  conversationId: string;
  summaryId: string | null;
  sourceStartSequence: number;
  sourceEndSequence: number;
  tokenBefore: number;
  tokenAfter: number | null;
  status: "started" | "completed" | "failed";
  failureCode: string | null;
  createdAt: string;
  completedAt: string | null;
}

export type MemoryScope = "user" | "project" | "conversation";
export type MemoryState = "candidate" | "active" | "disabled" | "expired" | "deleted";
export type MemoryCategory = "preference" | "identity" | "decision" | "todo";

/** 长期记忆的稳定身份与时态状态；正文保存在不可变版本中。 */
export interface MemoryItem {
  id: string;
  ownerUserId: string;
  projectId: string | null;
  conversationId: string | null;
  scope: MemoryScope;
  category: MemoryCategory;
  state: MemoryState;
  importance: number;
  confidence: number;
  validFrom: string;
  validUntil: string | null;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryVersion {
  id: string;
  memoryItemId: string;
  version: number;
  content: string;
  normalizedContent: string;
  reason: string;
  supersedesVersionId: string | null;
  createdByUserId: string;
  createdAt: string;
}

export interface MemorySource {
  id: string;
  memoryVersionId: string;
  sourceType: "message" | "commit" | "citation" | "explicit_user";
  sourceId: string;
  extractionMode: "explicit" | "automatic_candidate" | "manual_review";
  createdAt: string;
}

/** 记忆候选包含当前版本和来源，检索层据此做权限、时效和可追溯校验。 */
export interface MemoryCandidate {
  item: MemoryItem;
  version: MemoryVersion;
  sources: MemorySource[];
}

/** 模型调用实际引用的 ID 与预算；不复制敏感原文到审计记录。 */
export interface ContextSnapshot {
  id: string;
  conversationId: string;
  requestMessageId: string;
  scope: AiScope;
  projectId: string | null;
  branchId: string | null;
  fileId: string | null;
  folderId: string | null;
  selectedMessageIds: string[];
  selectedChunkIds: string[];
  selectedMemoryIds: string[];
  summaryId: string | null;
  tokenBudget: Record<string, number>;
  model: string;
  createdAt: string;
}

/** AI 只能提出 Patch；用户确认后也只能进入草稿分支。 */
export interface AiPatch {
  id: string;
  conversationId: string;
  messageId: string;
  branchId: string;
  baseRevisionId: string;
  patch: Record<string, unknown>;
  status: "proposed" | "accepted_to_draft" | "rejected" | "submitted";
  confirmedByUserId: string | null;
  mergeRequestId: string | null;
  createdAt: string;
  confirmedAt: string | null;
}

