import type { AuthorizedScope, ConversationMessage, ConversationSummary, CriticalFact, MemoryCandidate } from "@/lib/domain/memory";
import type { MemoryRepository } from "@/lib/repositories/memory";
import { NotFoundError, ValidationError } from "@/lib/domain/errors";
import { MemoryRetrievalService } from "@/lib/services/memory/memory-retrieval-service";
import { assertCriticalFactsHash } from "@/lib/services/memory/critical-fact-ledger";

/** 项目知识检索由外部 Provider 实现；输出仅允许包含授权后的片段 ID 与文本。 */
export interface ScopedEvidenceProvider {
  retrieve(input: { scope: AuthorizedScope; query: string; limit: number; tokenBudget: number }): Promise<Array<{ id: string; text: string; sourceId: string }>>;
}

/** 无项目检索 Provider 时明确返回空证据，不会偷偷读取旧工作台全库。 */
export class EmptyScopedEvidenceProvider implements ScopedEvidenceProvider {
  public async retrieve(): Promise<Array<{ id: string; text: string; sourceId: string }>> {
    return [];
  }
}

export interface ContextAssemblyInput {
  ownerUserId: string;
  conversationId: string;
  query: string;
  scope: AuthorizedScope;
  totalTokenBudget?: number;
  recentMessageBudget?: number;
  summaryBudget?: number;
  evidenceBudget?: number;
  memoryBudget?: number;
  factsBudget?: number;
}

/** 上下文摘要或 Scope 发生完整性问题时 fail closed，禁止模型读取未经校验的历史。 */
export class ContextIntegrityError extends ValidationError {
  public constructor(message = "上下文完整性校验失败") {
    super(message);
    this.name = "ContextIntegrityError";
  }
}

/** 可直接序列化给模型的有界上下文；每项均保留原始 ID。 */
export interface AssembledAiContext {
  scope: AuthorizedScope;
  query: string;
  recentMessages: ConversationMessage[];
  summary: ConversationSummary | null;
  evidence: Array<{ id: string; text: string; sourceId: string }>;
  memories: MemoryCandidate[];
  selectedMessageIds: string[];
  selectedChunkIds: string[];
  selectedMemoryIds: string[];
  /** 摘要预算不足时仍单独投影的关键事实账本。 */
  criticalFacts: CriticalFact[];
  estimatedTokens: number;
  budgets: Record<string, number>;
}

/**
 * 每轮重新组装微上下文，而不是不断追加历史。
 * 正式项目证据由 Scope Provider 提供；长期记忆只能来自当前 owner 和显式项目范围。
 */
export class ContextAssemblyService {
  public constructor(
    private readonly repository: MemoryRepository,
    private readonly evidenceProvider: ScopedEvidenceProvider = new EmptyScopedEvidenceProvider(),
  ) {}

  public async assemble(input: ContextAssemblyInput): Promise<AssembledAiContext> {
    const query = input.query.trim();
    if (!query) throw new ValidationError("上下文查询不能为空");
    const conversation = await this.repository.getConversation(input.conversationId, input.ownerUserId);
    if (!conversation) throw new NotFoundError("会话不存在");
    validateConversationScope(conversation, input.scope);

    const total = clamp(input.totalTokenBudget ?? 8_000, 512, 100_000);
    const budgets = {
      recent: clamp(input.recentMessageBudget ?? Math.floor(total * 0.3), 128, total),
      summary: clamp(input.summaryBudget ?? Math.floor(total * 0.12), 64, total),
      evidence: clamp(input.evidenceBudget ?? Math.floor(total * 0.4), 128, total),
      memory: clamp(input.memoryBudget ?? Math.floor(total * 0.08), 32, total),
      facts: clamp(input.factsBudget ?? Math.floor(total * 0.05), 32, total),
    };
    const allocated = Object.values(budgets).reduce((sum, value) => sum + value, 0);
    if (allocated > total) throw new ValidationError("上下文分项预算超过总预算");

    const allMessages = await this.repository.listMessages(conversation.id, input.ownerUserId);
    const recentMessages = takeNewestWithinBudget(allMessages, budgets.recent);
    const rawSummary = await this.repository.getLatestSummary(conversation.id, input.ownerUserId);
    validatePersistedSummary(rawSummary, allMessages);
    const criticalFacts = projectCriticalFacts(rawSummary?.structured.criticalFacts, budgets.facts);
    const summary = rawSummary && estimateTokens(JSON.stringify(rawSummary.structured)) <= budgets.summary ? rawSummary : null;
    const evidence = boundTextEntries(
      await this.evidenceProvider.retrieve({ scope: input.scope, query, limit: 12, tokenBudget: budgets.evidence }),
      budgets.evidence,
    );
    // public Scope 不得携带任何私人用户/项目/会话记忆，即使查询主体本身已登录。
    const memories = input.scope.scope === "public" ? [] : await new MemoryRetrievalService(this.repository).retrieve({
        ownerUserId: input.ownerUserId,
        projectId: input.scope.projectId,
        conversationId: conversation.id,
        query,
        maxEntries: 8,
        tokenBudget: budgets.memory,
      });
    const estimatedTokens = recentMessages.reduce((sum, item) => sum + item.tokenEstimate, 0)
      + (summary ? estimateTokens(JSON.stringify(summary.structured)) : 0)
      + (!summary ? estimateTokens(JSON.stringify(criticalFacts)) : 0)
      + evidence.reduce((sum, item) => sum + estimateTokens(item.text), 0)
      + memories.reduce((sum, item) => sum + estimateTokens(item.version.content), 0);

    return {
      scope: input.scope,
      query,
      recentMessages,
      summary,
      evidence,
      memories,
      selectedMessageIds: recentMessages.map((message) => message.id),
      selectedChunkIds: evidence.map((item) => item.id),
      selectedMemoryIds: memories.map((item) => item.item.id),
      criticalFacts,
      estimatedTokens,
      budgets,
    };
  }
}

/** 会话绑定的 project/branch 是硬边界；请求 Scope 不得借 ID 扩大或切换读取范围。 */
function validateConversationScope(conversation: { projectId: string | null; branchId: string | null }, scope: AuthorizedScope): void {
  if (scope.scope === "public") {
    if (scope.projectId || scope.branchId || scope.fileId || scope.folderId || scope.selectedText) {
      throw new ContextIntegrityError("公开 Scope 不得携带私人资源引用");
    }
    return;
  }
  if (!scope.projectId || conversation.projectId !== scope.projectId) {
    throw new ContextIntegrityError("会话与 AI Scope 的项目不一致");
  }
  if (conversation.branchId !== scope.branchId) {
    throw new ContextIntegrityError("会话与 AI Scope 的分支不一致");
  }
}

/**
 * 摘要来自追加写消息，但仍需校验其哈希和来源 ID；损坏时不降级为“最近消息继续回答”。
 */
function validatePersistedSummary(summary: ConversationSummary | null, messages: ConversationMessage[]): void {
  if (!summary) return;
  try {
    assertCriticalFactsHash(summary.structured.criticalFacts, summary.structured.criticalFactsHash);
  } catch (error) {
    if (error instanceof ValidationError) throw new ContextIntegrityError(error.message);
    throw error;
  }
  const messageIds = new Set(messages.map((message) => message.id));
  const missing = (summary.structured.criticalFacts ?? []).flatMap((fact) => fact.sourceMessageIds.filter((id) => !messageIds.has(id)));
  if (missing.length > 0 || summary.sourceMessageIds.some((id) => !messageIds.has(id))) {
    throw new ContextIntegrityError("上下文摘要引用了不存在的原始消息");
  }
}

/** 摘要被预算挤出时只投影账本；超预算则拒绝而不是静默丢掉关键事实。 */
function projectCriticalFacts(facts: CriticalFact[] | undefined, budget: number): CriticalFact[] {
  if (!facts || facts.length === 0) return [];
  const cost = estimateTokens(JSON.stringify(facts));
  if (cost > budget) throw new ContextIntegrityError("关键事实超过上下文预算，无法安全投影");
  return structuredClone(facts);
}

/** 无 tokenizer 依赖时使用保守估算；真实 Provider 可在模型网关处覆盖计量。 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const ascii = (text.match(/[\x00-\x7F]/g) ?? []).length;
  return Math.max(1, Math.ceil((text.length - ascii) * 0.75 + ascii / 4));
}

function takeNewestWithinBudget(messages: ConversationMessage[], budget: number): ConversationMessage[] {
  const selected: ConversationMessage[] = [];
  let used = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) continue;
    const cost = message.tokenEstimate || estimateTokens(message.content);
    if (selected.length > 0 && used + cost > budget) break;
    if (cost > budget && selected.length === 0) continue;
    selected.unshift(message);
    used += cost;
  }
  return selected;
}

function boundTextEntries<T extends { text: string }>(entries: T[], budget: number): T[] {
  const selected: T[] = [];
  let used = 0;
  for (const entry of entries) {
    const cost = estimateTokens(entry.text);
    if (used + cost > budget) continue;
    selected.push(entry);
    used += cost;
  }
  return selected;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}
