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
import type { ConversationQuery, MemoryQuery, MemoryRepository } from "@/lib/repositories/memory/memory-repository";

/** 测试专用内存仓储；所有返回值均深复制，避免测试绕过领域服务直接篡改状态。 */
export class InMemoryMemoryRepository implements MemoryRepository {
  private readonly conversations = new Map<string, Conversation>();
  private readonly messages = new Map<string, ConversationMessage[]>();
  private readonly tools = new Map<string, ToolExecution[]>();
  private readonly checkpoints = new Map<string, ConversationCheckpoint[]>();
  private readonly summaries = new Map<string, ConversationSummary[]>();
  private readonly snapshots: ContextSnapshot[] = [];
  private readonly patches: AiPatch[] = [];
  private readonly memoryItems = new Map<string, MemoryItem>();
  private readonly memoryVersions = new Map<string, MemoryVersion[]>();
  private readonly memorySources = new Map<string, MemorySource[]>();

  public async createConversation(conversation: Conversation): Promise<void> {
    if (this.conversations.has(conversation.id)) throw new Error("会话 ID 已存在");
    this.conversations.set(conversation.id, structuredClone(conversation));
  }

  public async getConversation(id: string, ownerUserId: string): Promise<Conversation | null> {
    const value = this.conversations.get(id);
    return value?.ownerUserId === ownerUserId ? structuredClone(value) : null;
  }

  public async listConversations(query: ConversationQuery): Promise<Conversation[]> {
    const needle = normalize(query.query ?? "");
    const values = Array.from(this.conversations.values()).filter((conversation) => {
      if (conversation.ownerUserId !== query.ownerUserId) return false;
      if (query.status && conversation.status !== query.status) return false;
      if (query.projectId && conversation.projectId !== query.projectId) return false;
      if (!needle) return true;
      const hasMessage = (this.messages.get(conversation.id) ?? []).some((message) => normalize(message.content).includes(needle));
      return normalize(conversation.title).includes(needle) || hasMessage;
    });
    values.sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.updatedAt.localeCompare(left.updatedAt));
    return structuredClone(values.slice(query.offset, query.offset + query.limit));
  }

  public async updateConversation(conversation: Conversation): Promise<void> {
    const prior = this.conversations.get(conversation.id);
    if (!prior || prior.ownerUserId !== conversation.ownerUserId) throw new Error("会话不存在");
    this.conversations.set(conversation.id, structuredClone(conversation));
  }

  public async appendMessage(message: ConversationMessage): Promise<void> {
    const owner = this.conversations.get(message.conversationId);
    if (!owner) throw new Error("会话不存在");
    const values = this.messages.get(message.conversationId) ?? [];
    if (values.some((item) => item.id === message.id || item.sequence === message.sequence)) throw new Error("消息序号冲突");
    values.push(structuredClone(message));
    values.sort((left, right) => left.sequence - right.sequence);
    this.messages.set(message.conversationId, values);
  }

  public async listMessages(conversationId: string, ownerUserId: string): Promise<ConversationMessage[]> {
    if (!(await this.getConversation(conversationId, ownerUserId))) return [];
    return structuredClone(this.messages.get(conversationId) ?? []);
  }

  public async listTools(conversationId: string, ownerUserId: string): Promise<ToolExecution[]> {
    if (!(await this.getConversation(conversationId, ownerUserId))) return [];
    return structuredClone(this.tools.get(conversationId) ?? []);
  }

  public async insertTool(tool: ToolExecution): Promise<void> {
    const values = this.tools.get(tool.conversationId) ?? [];
    if (values.some((item) => item.id === tool.id || item.callMessageId === tool.callMessageId)) throw new Error("工具调用已存在");
    values.push(structuredClone(tool));
    this.tools.set(tool.conversationId, values);
  }

  public async updateTool(tool: ToolExecution): Promise<void> {
    const values = this.tools.get(tool.conversationId) ?? [];
    const index = values.findIndex((item) => item.id === tool.id);
    if (index < 0) throw new Error("工具调用不存在");
    values[index] = structuredClone(tool);
  }

  public async insertCheckpoint(checkpoint: ConversationCheckpoint): Promise<void> {
    const values = this.checkpoints.get(checkpoint.conversationId) ?? [];
    values.push(structuredClone(checkpoint));
    this.checkpoints.set(checkpoint.conversationId, values);
  }

  public async updateCheckpoint(checkpoint: ConversationCheckpoint): Promise<void> {
    const values = this.checkpoints.get(checkpoint.conversationId) ?? [];
    const index = values.findIndex((item) => item.id === checkpoint.id);
    if (index < 0) throw new Error("压缩检查点不存在");
    values[index] = structuredClone(checkpoint);
  }

  public async listCheckpoints(conversationId: string, ownerUserId: string): Promise<ConversationCheckpoint[]> {
    if (!(await this.getConversation(conversationId, ownerUserId))) return [];
    return structuredClone(this.checkpoints.get(conversationId) ?? []);
  }

  public async insertSummary(summary: ConversationSummary): Promise<void> {
    const values = this.summaries.get(summary.conversationId) ?? [];
    values.push(structuredClone(summary));
    this.summaries.set(summary.conversationId, values);
  }

  public async getLatestSummary(conversationId: string, ownerUserId: string): Promise<ConversationSummary | null> {
    if (!(await this.getConversation(conversationId, ownerUserId))) return null;
    const values = this.summaries.get(conversationId) ?? [];
    const summary = [...values].sort((left, right) => right.version - left.version)[0];
    return summary ? structuredClone(summary) : null;
  }

  public async insertContextSnapshot(snapshot: ContextSnapshot): Promise<void> {
    this.snapshots.push(structuredClone(snapshot));
  }

  public async insertAiPatch(patch: AiPatch): Promise<void> {
    this.patches.push(structuredClone(patch));
  }

  public async createMemory(item: MemoryItem, version: MemoryVersion, sources: MemorySource[]): Promise<void> {
    if (this.memoryItems.has(item.id)) throw new Error("记忆 ID 已存在");
    this.memoryItems.set(item.id, structuredClone(item));
    this.memoryVersions.set(item.id, [structuredClone(version)]);
    this.memorySources.set(version.id, structuredClone(sources));
  }

  public async getMemory(id: string, ownerUserId: string): Promise<MemoryCandidate | null> {
    const item = this.memoryItems.get(id);
    if (!item || item.ownerUserId !== ownerUserId) return null;
    const versions = this.memoryVersions.get(id) ?? [];
    const version = versions.find((entry) => entry.version === item.currentVersion);
    if (!version) return null;
    return structuredClone({ item, version, sources: this.memorySources.get(version.id) ?? [] });
  }

  public async updateMemory(item: MemoryItem, version?: MemoryVersion, sources: MemorySource[] = []): Promise<void> {
    const prior = this.memoryItems.get(item.id);
    if (!prior || prior.ownerUserId !== item.ownerUserId) throw new Error("记忆不存在");
    this.memoryItems.set(item.id, structuredClone(item));
    if (version) {
      const versions = this.memoryVersions.get(item.id) ?? [];
      versions.push(structuredClone(version));
      this.memoryVersions.set(item.id, versions);
      this.memorySources.set(version.id, structuredClone(sources));
    }
  }

  public async listMemories(query: MemoryQuery): Promise<MemoryCandidate[]> {
    return this.filterMemories(query, false);
  }

  public async searchMemories(query: MemoryQuery): Promise<MemoryCandidate[]> {
    return this.filterMemories(query, true);
  }

  /** 先做 owner/scope/时效过滤，再做确定性词项匹配，模拟 PostgreSQL FTS 的安全顺序。 */
  private async filterMemories(query: MemoryQuery, requireMatch: boolean): Promise<MemoryCandidate[]> {
    const terms = tokenize(query.query);
    const now = Date.parse(query.now);
    const candidates: Array<{ candidate: MemoryCandidate; score: number }> = [];
    for (const item of Array.from(this.memoryItems.values())) {
      if (item.ownerUserId !== query.ownerUserId || item.state !== "active") continue;
      if (item.validUntil && Date.parse(item.validUntil) <= now) continue;
      if (item.scope === "project" && (!query.projectId || item.projectId !== query.projectId)) continue;
      if (item.scope === "conversation" && (!query.conversationId || item.conversationId !== query.conversationId)) continue;
      const current = (this.memoryVersions.get(item.id) ?? []).find((entry) => entry.version === item.currentVersion);
      if (!current) continue;
      const normalized = normalize(current.normalizedContent);
      const lexical = terms.reduce((sum, term) => sum + (normalized.includes(term) ? 1 : 0), 0);
      if (requireMatch && terms.length > 0 && lexical === 0) continue;
      const recency = Math.max(0, 1 - (now - Date.parse(item.updatedAt)) / (365 * 24 * 60 * 60 * 1000));
      candidates.push({
        candidate: { item, version: current, sources: this.memorySources.get(current.id) ?? [] },
        score: lexical * 10 + item.importance * 2 + item.confidence + recency,
      });
    }
    candidates.sort((left, right) => right.score - left.score || right.candidate.item.updatedAt.localeCompare(left.candidate.item.updatedAt));
    return structuredClone(candidates.slice(0, query.limit).map((entry) => entry.candidate));
  }
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/\s+/g, " ").trim();
}

function tokenize(value: string): string[] {
  return Array.from(new Set(normalize(value).split(/[\s,，。！？；：/]+/).filter(Boolean)));
}
