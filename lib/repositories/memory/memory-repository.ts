import type {
  AiPatch,
  ContextSnapshot,
  Conversation,
  ConversationCheckpoint,
  ConversationMessage,
  ConversationSummary,
  MemoryCandidate,
  MemoryItem,
  MemorySource,
  MemoryVersion,
  ToolExecution,
} from "@/lib/domain/memory";

/** 对话列表和全文搜索的固定过滤条件；ownerUserId 永远由认证层提供。 */
export interface ConversationQuery {
  ownerUserId: string;
  status?: "active" | "archived" | "deleted";
  projectId?: string;
  query?: string;
  limit: number;
  offset: number;
}

/** 长期记忆检索必须携带完整作用域，禁止无 owner 的全库查询。 */
export interface MemoryQuery {
  ownerUserId: string;
  projectId: string | null;
  conversationId: string | null;
  query: string;
  now: string;
  limit: number;
}

/** 会话和记忆的持久化边界；实现不得删除原始消息或覆盖历史版本。 */
export interface MemoryRepository {
  createConversation(conversation: Conversation): Promise<void>;
  getConversation(id: string, ownerUserId: string): Promise<Conversation | null>;
  listConversations(query: ConversationQuery): Promise<Conversation[]>;
  updateConversation(conversation: Conversation): Promise<void>;
  appendMessage(message: ConversationMessage): Promise<void>;
  listMessages(conversationId: string, ownerUserId: string): Promise<ConversationMessage[]>;
  listTools(conversationId: string, ownerUserId: string): Promise<ToolExecution[]>;
  insertTool(tool: ToolExecution): Promise<void>;
  updateTool(tool: ToolExecution): Promise<void>;
  insertCheckpoint(checkpoint: ConversationCheckpoint): Promise<void>;
  updateCheckpoint(checkpoint: ConversationCheckpoint): Promise<void>;
  /** 将摘要、已完成检查点和会话版本在同一事务中提交，禁止产生孤儿摘要。 */
  commitCompaction(input: { conversation: Conversation; summary: ConversationSummary; checkpoint: ConversationCheckpoint }): Promise<void>;
  listCheckpoints(conversationId: string, ownerUserId: string): Promise<ConversationCheckpoint[]>;
  insertSummary(summary: ConversationSummary): Promise<void>;
  getLatestSummary(conversationId: string, ownerUserId: string): Promise<ConversationSummary | null>;
  insertContextSnapshot(snapshot: ContextSnapshot): Promise<void>;
  insertAiPatch(patch: AiPatch): Promise<void>;
  createMemory(item: MemoryItem, version: MemoryVersion, sources: MemorySource[]): Promise<void>;
  getMemory(id: string, ownerUserId: string): Promise<MemoryCandidate | null>;
  updateMemory(item: MemoryItem, version?: MemoryVersion, sources?: MemorySource[]): Promise<void>;
  listMemories(query: MemoryQuery): Promise<MemoryCandidate[]>;
  searchMemories(query: MemoryQuery): Promise<MemoryCandidate[]>;
}
