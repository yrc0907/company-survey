import { createHash, randomUUID } from "node:crypto";

import { NotFoundError, ValidationError } from "@/lib/domain/errors";
import type { ConversationCheckpoint, ConversationMessage, ConversationSummary, ToolExecution } from "@/lib/domain/memory";
import type { MemoryRepository } from "@/lib/repositories/memory";
import { estimateTokens } from "@/lib/services/context/context-assembly-service";
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
      const tokenAfter = estimateTokens(JSON.stringify(structured));
      if (tokenAfter >= tokenBefore) throw new Error("SUMMARY_NOT_SMALLER");
      const summary: ConversationSummary = {
        id: randomUUID(), conversationId: conversation.id, version: conversation.summaryVersion + 1, structured,
        sourceStartSequence: candidates[0]!.sequence, sourceEndSequence: candidates.at(-1)!.sequence,
        sourceMessageIds: candidates.map((message) => message.id), provider: this.provider.name, model: this.provider.model, createdAt: new Date().toISOString(),
      };
      await this.repository.insertSummary(summary);
      checkpoint = { ...checkpoint, summaryId: summary.id, tokenAfter, status: "completed", completedAt: new Date().toISOString() };
      await this.repository.updateCheckpoint(checkpoint);
      await this.repository.updateConversation({ ...conversation, summaryVersion: summary.version, updatedAt: checkpoint.completedAt! });
      return { checkpoint, summary };
    } catch (error) {
      const failureCode = error instanceof Error && error.message === "SUMMARY_NOT_SMALLER" ? "summary_not_smaller" : "summary_failed";
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

function validateStructuredSummary(summary: object): void {
  const value = summary as Partial<Record<keyof import("@/lib/domain/memory").StructuredConversationSummary, unknown>>;
  const keys = ["goal", "decisions", "constraints", "entities", "claims", "citationIds", "todos", "conflicts"] as const;
  if (keys.some((key) => !Array.isArray(value[key]))) throw new ValidationError("摘要 Provider 返回的结构不完整");
}
