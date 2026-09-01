import type { AuthorizedScope, ConversationMessage, ConversationSummary, MemoryCandidate } from "@/lib/domain/memory";
import type { MemoryRepository } from "@/lib/repositories/memory";
import { NotFoundError, ValidationError } from "@/lib/domain/errors";
import { MemoryRetrievalService } from "@/lib/services/memory/memory-retrieval-service";

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

    const total = clamp(input.totalTokenBudget ?? 8_000, 512, 100_000);
    const budgets = {
      recent: clamp(input.recentMessageBudget ?? Math.floor(total * 0.3), 128, total),
      summary: clamp(input.summaryBudget ?? Math.floor(total * 0.12), 64, total),
      evidence: clamp(input.evidenceBudget ?? Math.floor(total * 0.4), 128, total),
      memory: clamp(input.memoryBudget ?? Math.floor(total * 0.08), 32, total),
    };
    const allocated = Object.values(budgets).reduce((sum, value) => sum + value, 0);
    if (allocated > total) throw new ValidationError("上下文分项预算超过总预算");

    const allMessages = await this.repository.listMessages(conversation.id, input.ownerUserId);
    const recentMessages = takeNewestWithinBudget(allMessages, budgets.recent);
    const rawSummary = await this.repository.getLatestSummary(conversation.id, input.ownerUserId);
    const summary = rawSummary && estimateTokens(JSON.stringify(rawSummary.structured)) <= budgets.summary ? rawSummary : null;
    const evidence = boundTextEntries(
      await this.evidenceProvider.retrieve({ scope: input.scope, query, limit: 12, tokenBudget: budgets.evidence }),
      budgets.evidence,
    );
    const memories = await new MemoryRetrievalService(this.repository).retrieve({
      ownerUserId: input.ownerUserId,
      projectId: input.scope.projectId,
      conversationId: conversation.id,
      query,
      maxEntries: 8,
      tokenBudget: budgets.memory,
    });
    const estimatedTokens = recentMessages.reduce((sum, item) => sum + item.tokenEstimate, 0)
      + (summary ? estimateTokens(JSON.stringify(summary.structured)) : 0)
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
      estimatedTokens,
      budgets,
    };
  }
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

