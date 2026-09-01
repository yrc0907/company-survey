import { createHash, randomUUID } from "node:crypto";

import { NotFoundError, ValidationError } from "@/lib/domain/errors";
import type { ConversationCheckpoint, ConversationMessage, ConversationSummary, StructuredConversationSummary, ToolExecution } from "@/lib/domain/memory";
import type { MemoryRepository } from "@/lib/repositories/memory";
import { estimateTokens } from "@/lib/services/context/context-assembly-service";
import {
  assertCriticalFactsHash,
  assertCriticalFactsPreserved,
  criticalFactsHash,
  extractCriticalFacts,
  mergeCriticalFacts,
} from "@/lib/services/memory/critical-fact-ledger";
import type { ConversationSummaryProvider } from "@/lib/services/memory/summary-provider";

/** 连续失败达到阈值后的显式熔断；调用方应缩小 Scope 或新建对话。 */
export class CompactionCircuitOpenError extends ValidationError {
  public constructor() {
    super("连续三次上下文压缩失败；请缩小 AI 范围或新建对话后再试");
    this.name = "CompactionCircuitOpenError";
  }
}

/** 已存在仍在有效租期内的 started 检查点；并发压缩必须等待而不能重复执行。 */
export class CompactionBusyError extends ValidationError {
  public constructor() {
    super("当前会话已有压缩任务进行中");
    this.name = "CompactionBusyError";
  }
}

/** 可审计压缩事务：只追加 summary/checkpoint，绝不删除原始消息。 */
export class ConversationCompactionService {
  public constructor(private readonly repository: MemoryRepository, private readonly provider: ConversationSummaryProvider) {}

  /** 压缩最近保护窗口之前的闭合消息区间；工具调用与结果始终成对。 */
  public async compact(input: { ownerUserId: string; conversationId: string; protectRecentMessages?: number }): Promise<{ checkpoint: ConversationCheckpoint; summary: ConversationSummary }> {
    const conversation = await this.repository.getConversation(input.conversationId, input.ownerUserId);
    if (!conversation || conversation.status === "deleted") throw new NotFoundError("会话不存在");
    let checkpoints = await this.repository.listCheckpoints(conversation.id, conversation.ownerUserId);
    const unfinished = [...checkpoints].reverse().find((checkpoint) => checkpoint.status === "started");
    if (unfinished) {
      const age = Date.now() - Date.parse(unfinished.createdAt);
      if (Number.isFinite(age) && age < 10 * 60 * 1_000) throw new CompactionBusyError();
      // 进程崩溃留下的 started 不能永久锁死会话；先落失败终态，再重新评估熔断。
      const recovered: ConversationCheckpoint = {
        ...unfinished,
        status: "failed",
        failureCode: "orphaned_started",
        completedAt: new Date().toISOString(),
      };
      await this.repository.updateCheckpoint(recovered);
      checkpoints = checkpoints.map((checkpoint) => checkpoint.id === recovered.id ? recovered : checkpoint);
    }
    const consecutiveFailures = [...checkpoints].reverse().findIndex((checkpoint) => checkpoint.status !== "failed");
    if ((consecutiveFailures === -1 ? checkpoints.length : consecutiveFailures) >= 3) throw new CompactionCircuitOpenError();

    const messages = await this.repository.listMessages(conversation.id, conversation.ownerUserId);
    const tools = await this.repository.listTools(conversation.id, conversation.ownerUserId);
    validateToolPairings(messages, tools);
    const lastCompletedEnd = [...checkpoints].reverse().find((checkpoint) => checkpoint.status === "completed")?.sourceEndSequence ?? 0;
    const protectCount = Math.min(20, Math.max(2, input.protectRecentMessages ?? 4));
    const eligible = messages.filter((message) => message.sequence > lastCompletedEnd);
    let candidates = eligible.slice(0, Math.max(0, eligible.length - protectCount));
    candidates = closeToolBoundary(candidates, messages, tools);
    if (candidates.length < 2) throw new ValidationError("没有足够的闭合历史可压缩");

    const tokenBefore = candidates.reduce((sum, message) => sum + (message.tokenEstimate || estimateTokens(message.content)), 0);
    const now = new Date().toISOString();
    let checkpoint: ConversationCheckpoint = {
      id: randomUUID(), conversationId: conversation.id, summaryId: null,
      sourceStartSequence: candidates[0]!.sequence, sourceEndSequence: candidates.at(-1)!.sequence,
      tokenBefore, tokenAfter: null, status: "started", failureCode: null, createdAt: now, completedAt: null,
    };
    await this.repository.insertCheckpoint(checkpoint);

    try {
      const previous = await this.repository.getLatestSummary(conversation.id, conversation.ownerUserId);
      const prepared = candidates.map(pruneLargeToolResult);
      const structured = await this.provider.summarize({ messages: prepared, previous });
      validateStructuredSummary(structured);
      // 压缩前后对比最小事实账本；缺失即失败，不能用“摘要成功”掩盖金额/日期/ID 漂移。
      const expectedFacts = mergeCriticalFacts(previous?.structured.criticalFacts, extractCriticalFacts(candidates));
      assertCriticalFactsHash(structured.criticalFacts, structured.criticalFactsHash);
      assertCriticalFactsPreserved(expectedFacts, structured.criticalFacts);
      const persistedStructured: StructuredConversationSummary = {
        ...structured,
        criticalFacts: structured.criticalFacts ? mergeCriticalFacts([], structured.criticalFacts) : undefined,
        criticalFactsHash: structured.criticalFacts ? criticalFactsHash(structured.criticalFacts) : undefined,
      };
      const tokenAfter = estimateTokens(JSON.stringify(persistedStructured));
      if (tokenAfter >= tokenBefore) throw new Error("SUMMARY_NOT_SMALLER");
      const completedAt = new Date().toISOString();
      const summary: ConversationSummary = {
        id: randomUUID(), conversationId: conversation.id, version: conversation.summaryVersion + 1, structured: persistedStructured,
        sourceStartSequence: candidates[0]!.sequence, sourceEndSequence: candidates.at(-1)!.sequence,
        sourceMessageIds: candidates.map((message) => message.id), provider: this.provider.name, model: this.provider.model, createdAt: completedAt,
      };
      checkpoint = { ...checkpoint, summaryId: summary.id, tokenAfter, status: "completed", completedAt };
      // 原子提交避免 insertSummary 成功而 checkpoint/conversation 更新失败时留下孤儿摘要。
      await this.repository.commitCompaction({
        conversation: { ...conversation, summaryVersion: summary.version, updatedAt: completedAt },
        summary,
        checkpoint,
      });
      return { checkpoint, summary };
    } catch (error) {
      const failureCode = error instanceof Error && error.message === "SUMMARY_NOT_SMALLER"
        ? "summary_not_smaller"
        : error instanceof Error && (error.message.startsWith("压缩摘要丢失关键事实") || error.message.startsWith("上下文摘要关键事实校验失败"))
          ? "critical_fact_drift"
          : "summary_failed";
      checkpoint = { ...checkpoint, status: "failed", failureCode, completedAt: new Date().toISOString() };
      await this.repository.updateCheckpoint(checkpoint);
      throw error;
    }
  }
}

/** 将超过预算的工具结果替换为可回取指纹，避免把大 JSON 反复送进摘要模型。 */
function pruneLargeToolResult(message: ConversationMessage): ConversationMessage {
  if (message.role !== "tool" || message.content.length <= 4_000) return message;
  const hash = createHash("sha256").update(message.content).digest("hex");
  const content = `${message.content.slice(0, 1_200)}\n...[tool result pruned sha256:${hash}]...\n${message.content.slice(-1_200)}`;
  return { ...message, content, tokenEstimate: estimateTokens(content), metadata: { ...message.metadata, pruned: true, originalHash: hash } };
}

/** 收缩候选末端直到不会拆开任意 tool call/result；无法闭合的孤立 result 明确失败。 */
function closeToolBoundary(candidates: ConversationMessage[], allMessages: ConversationMessage[], tools: ToolExecution[]): ConversationMessage[] {
  if (candidates.length === 0) return candidates;
  const sequenceById = new Map(allMessages.map((message) => [message.id, message.sequence]));
  let start = candidates[0]!.sequence;
  let end = candidates.at(-1)!.sequence;
  let changed = true;
  while (changed) {
    changed = false;
    for (const tool of tools) {
      const call = sequenceById.get(tool.callMessageId);
      const result = tool.resultMessageId ? sequenceById.get(tool.resultMessageId) : undefined;
      const callInside = call !== undefined && call >= start && call <= end;
      const resultInside = result !== undefined && result >= start && result <= end;
      if (resultInside && !callInside) throw new ValidationError("压缩区间包含孤立工具结果");
      if (callInside && !resultInside) {
        end = call! - 1;
        changed = true;
      }
    }
  }
  return candidates.filter((message) => message.sequence >= start && message.sequence <= end);
}

/**
 * 压缩前校验工具事件的会话、角色和结果配对。
 * 未登记的 tool 消息或跨会话引用会使范围不可审计，宁可失败也不把它当普通文本压缩。
 */
function validateToolPairings(messages: ConversationMessage[], tools: ToolExecution[]): void {
  const byId = new Map(messages.map((message) => [message.id, message]));
  const resultIds = new Set<string>();
  for (const tool of tools) {
    if (tool.conversationId !== messages[0]?.conversationId) throw new ValidationError("工具事件会话不一致");
    const call = byId.get(tool.callMessageId);
    if (!call || call.conversationId !== tool.conversationId || (call.role !== "assistant" && call.role !== "system")) {
      throw new ValidationError("工具调用消息无效或不属于当前会话");
    }
    if (tool.resultMessageId) {
      const result = byId.get(tool.resultMessageId);
      if (!result || result.conversationId !== tool.conversationId || result.role !== "tool") {
        throw new ValidationError("工具结果消息无效或不属于当前会话");
      }
      resultIds.add(result.id);
    } else if (tool.status !== "requested") {
      throw new ValidationError("已结束的工具调用必须包含结果消息");
    }
  }
  for (const message of messages) {
    if (message.role === "tool" && !resultIds.has(message.id)) throw new ValidationError("存在未登记的工具结果消息");
  }
}

function validateStructuredSummary(summary: object): void {
  const value = summary as Partial<Record<keyof import("@/lib/domain/memory").StructuredConversationSummary, unknown>>;
  const keys = ["goal", "decisions", "constraints", "entities", "claims", "citationIds", "todos", "conflicts"] as const;
  if (keys.some((key) => !Array.isArray(value[key]))) throw new ValidationError("摘要 Provider 返回的结构不完整");
}
