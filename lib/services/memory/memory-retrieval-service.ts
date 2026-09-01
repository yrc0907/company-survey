import { randomUUID } from "node:crypto";

import { NotFoundError, ValidationError } from "@/lib/domain/errors";
import type { MemoryCandidate, MemoryCategory, MemoryItem, MemoryScope, MemorySource, MemoryState, MemoryVersion } from "@/lib/domain/memory";
import type { MemoryRepository } from "@/lib/repositories/memory";
import { estimateTokens } from "@/lib/services/context/context-assembly-service";

/** 长期记忆写入和时态更新服务；正式项目事实不得通过本服务直接创建。 */
export class MemoryManagementService {
  public constructor(private readonly repository: MemoryRepository) {}

  /** 创建候选或用户明确启用的记忆；每条记忆必须至少有一个可追溯来源。 */
  public async create(input: {
    ownerUserId: string; projectId?: string; conversationId?: string; scope: MemoryScope; category: MemoryCategory;
    content: string; state?: "candidate" | "active"; importance?: number; confidence?: number; validUntil?: string;
    sources: Array<Omit<MemorySource, "id" | "memoryVersionId" | "createdAt">>;
  }): Promise<MemoryCandidate> {
    const owner = requireValue(input.ownerUserId, "用户 ID");
    const content = requireContent(input.content);
    if (input.sources.length === 0) throw new ValidationError("长期记忆必须保留来源");
    if (input.scope === "project" && !input.projectId) throw new ValidationError("项目记忆必须包含 projectId");
    if (input.scope === "conversation" && !input.conversationId) throw new ValidationError("会话记忆必须包含 conversationId");
    if (input.scope === "conversation" && input.conversationId) {
      const conversation = await this.repository.getConversation(input.conversationId, owner);
      if (!conversation || (input.projectId && conversation.projectId !== input.projectId)) {
        throw new ValidationError("会话记忆作用域无法确认");
      }
    }
    if (input.category !== "preference" && input.state === "active" && input.sources.some((source) => source.extractionMode === "automatic_candidate")) {
      throw new ValidationError("自动提取的身份、决定或待办必须先由用户确认");
    }
    const now = new Date().toISOString();
    const id = randomUUID();
    const versionId = randomUUID();
    const item: MemoryItem = {
      id, ownerUserId: owner, projectId: input.projectId ?? null, conversationId: input.conversationId ?? null,
      scope: input.scope, category: input.category, state: input.state ?? "candidate",
      importance: bounded(input.importance ?? 0.5), confidence: bounded(input.confidence ?? 0.5),
      validFrom: now, validUntil: parseOptionalDate(input.validUntil), currentVersion: 1, createdAt: now, updatedAt: now,
    };
    const version: MemoryVersion = {
      id: versionId, memoryItemId: id, version: 1, content, normalizedContent: normalize(content), reason: "created",
      supersedesVersionId: null, createdByUserId: owner, createdAt: now,
    };
    const sources = input.sources.map((source) => ({ ...source, id: randomUUID(), memoryVersionId: versionId, createdAt: now }));
    await this.repository.createMemory(item, version, sources);
    return { item, version, sources };
  }

  /** 创建新版本并链接 supersession；旧版本保留，不能原地覆盖。 */
  public async supersede(input: { ownerUserId: string; memoryId: string; content: string; reason: string; sources: Array<Omit<MemorySource, "id" | "memoryVersionId" | "createdAt">> }): Promise<MemoryCandidate> {
    const prior = await this.requireMemory(input.memoryId, input.ownerUserId);
    if (prior.item.state === "deleted") throw new NotFoundError("记忆不存在");
    if (input.sources.length === 0) throw new ValidationError("新版本必须保留来源");
    const now = new Date().toISOString();
    const version: MemoryVersion = {
      id: randomUUID(), memoryItemId: prior.item.id, version: prior.item.currentVersion + 1,
      content: requireContent(input.content), normalizedContent: normalize(input.content), reason: requireValue(input.reason, "更新原因"),
      supersedesVersionId: prior.version.id, createdByUserId: input.ownerUserId, createdAt: now,
    };
    const sources = input.sources.map((source) => ({ ...source, id: randomUUID(), memoryVersionId: version.id, createdAt: now }));
    const item = { ...prior.item, currentVersion: version.version, updatedAt: now };
    await this.repository.updateMemory(item, version, sources);
    return { item, version, sources };
  }

  /** 启用、禁用、过期或软删除记忆；历史版本和来源仍保留审计。 */
  public async setState(ownerUserId: string, memoryId: string, state: MemoryState): Promise<MemoryCandidate> {
    const prior = await this.requireMemory(memoryId, ownerUserId);
    if (prior.item.state === "deleted" && state !== "deleted") throw new NotFoundError("记忆不存在");
    const item = { ...prior.item, state, updatedAt: new Date().toISOString() };
    await this.repository.updateMemory(item);
    return { ...prior, item };
  }

  private async requireMemory(memoryId: string, ownerUserId: string): Promise<MemoryCandidate> {
    const memory = await this.repository.getMemory(requireValue(memoryId, "记忆 ID"), requireValue(ownerUserId, "用户 ID"));
    if (!memory) throw new NotFoundError("记忆不存在");
    return memory;
  }
}

/** 确定性候选检索和有界注入；无来源、过期、禁用和越界候选一律丢弃。 */
export class MemoryRetrievalService {
  public constructor(private readonly repository: MemoryRepository) {}

  public async retrieve(input: { ownerUserId: string; projectId: string | null; conversationId: string | null; query: string; now?: string; maxEntries?: number; tokenBudget?: number }): Promise<MemoryCandidate[]> {
    const query = input.query.trim();
    if (!query) return [];
    const ownerUserId = requireValue(input.ownerUserId, "用户 ID");
    const projectId = input.projectId?.trim() || null;
    const conversationId = input.conversationId?.trim() || null;
    if (conversationId) {
      // 先确认会话属于当前用户，并且 project 绑定一致；不能用任意会话 ID 查询另一条历史。
      const conversation = await this.repository.getConversation(conversationId, ownerUserId);
      if (!conversation || (projectId !== null && conversation.projectId !== projectId)) {
        throw new ValidationError("记忆会话作用域无法确认");
      }
    }
    const maxEntries = Math.min(10, Math.max(1, input.maxEntries ?? 8));
    const tokenBudget = Math.min(4_096, Math.max(32, input.tokenBudget ?? 768));
    const candidates = await this.repository.searchMemories({
      ownerUserId, projectId, conversationId,
      query: query.slice(0, 1_000), now: input.now ?? new Date().toISOString(), limit: maxEntries * 3,
    });
    const selected: MemoryCandidate[] = [];
    let used = 0;
    for (const candidate of candidates) {
      if (candidate.sources.length === 0 || candidate.item.state !== "active") continue;
      const cost = estimateTokens(candidate.version.content);
      if (used + cost > tokenBudget) continue;
      selected.push(candidate);
      used += cost;
      if (selected.length >= maxEntries) break;
    }
    return selected;
  }
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/\s+/g, " ").trim();
}

function requireValue(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 2_000) throw new ValidationError(`${label}无效`);
  return normalized;
}

function requireContent(value: string): string {
  const content = value.trim();
  if (!content || content.length > 20_000) throw new ValidationError("记忆正文必须为 1 到 20000 个字符");
  return content;
}

function bounded(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new ValidationError("记忆权重必须介于 0 和 1");
  return value;
}

function parseOptionalDate(value: string | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) throw new ValidationError("记忆失效时间无效");
  return parsed.toISOString();
}
