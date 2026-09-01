import { randomUUID } from "node:crypto";

import { NotFoundError, ValidationError } from "@/lib/domain/errors";
import type { Conversation, ConversationMessage, ConversationRole } from "@/lib/domain/memory";
import type { MemoryRepository } from "@/lib/repositories/memory";
import { estimateTokens } from "@/lib/services/context/context-assembly-service";

export interface CreateConversationInput {
  ownerUserId: string;
  title?: string;
  projectId?: string;
  branchId?: string;
  parentConversationId?: string;
  parentMessageId?: string;
}

/** 会话生命周期服务；所有查询都强制携带 ownerUserId，跨用户 ID 表现为不存在。 */
export class ConversationService {
  public constructor(private readonly repository: MemoryRepository) {}

  /** 创建新的私人会话；项目和分支只保存引用，不隐式授予读取权限。 */
  public async create(input: CreateConversationInput): Promise<Conversation> {
    const ownerUserId = requireIdentifier(input.ownerUserId, "用户");
    const title = normalizeTitle(input.title ?? "新对话");
    const now = new Date().toISOString();
    const conversation: Conversation = {
      id: randomUUID(),
      ownerUserId,
      projectId: optionalIdentifier(input.projectId),
      branchId: optionalIdentifier(input.branchId),
      parentConversationId: optionalIdentifier(input.parentConversationId),
      parentMessageId: optionalIdentifier(input.parentMessageId),
      title,
      status: "active",
      pinned: false,
      summaryVersion: 0,
      createdAt: now,
      updatedAt: now,
      lastMessageAt: null,
    };
    await this.repository.createConversation(conversation);
    return conversation;
  }

  /** 返回当前用户的会话详情和完整原始消息；删除状态默认也不可见。 */
  public async get(ownerUserId: string, conversationId: string): Promise<{ conversation: Conversation; messages: ConversationMessage[] }> {
    const conversation = await this.requireConversation(ownerUserId, conversationId);
    if (conversation.status === "deleted") throw new NotFoundError("会话不存在");
    return { conversation, messages: await this.repository.listMessages(conversation.id, ownerUserId) };
  }

  /** 历史列表与搜索共用一个固定查询接口，限制分页规模避免拉取完整历史。 */
  public async list(input: { ownerUserId: string; status?: "active" | "archived"; projectId?: string; query?: string; limit?: number; offset?: number }): Promise<Conversation[]> {
    return this.repository.listConversations({
      ownerUserId: requireIdentifier(input.ownerUserId, "用户"),
      status: input.status ?? "active",
      projectId: optionalIdentifier(input.projectId) ?? undefined,
      query: input.query?.trim().slice(0, 200),
      limit: Math.min(100, Math.max(1, input.limit ?? 30)),
      offset: Math.max(0, input.offset ?? 0),
    });
  }

  /** 追加原始消息并单调递增 sequence；不会修改或覆盖旧消息。 */
  public async appendMessage(input: { ownerUserId: string; conversationId: string; role: ConversationRole; content: string; parentMessageId?: string; metadata?: Record<string, unknown> }): Promise<ConversationMessage> {
    const conversation = await this.requireConversation(input.ownerUserId, input.conversationId);
    if (conversation.status !== "active") throw new ValidationError("只能向活动会话追加消息");
    const content = input.content.trim();
    if (!content) throw new ValidationError("消息不能为空");
    if (content.length > 200_000) throw new ValidationError("消息超过 200000 个字符");
    const messages = await this.repository.listMessages(conversation.id, conversation.ownerUserId);
    const now = new Date().toISOString();
    const message: ConversationMessage = {
      id: randomUUID(),
      conversationId: conversation.id,
      sequence: (messages.at(-1)?.sequence ?? 0) + 1,
      role: input.role,
      content,
      tokenEstimate: estimateTokens(content),
      parentMessageId: optionalIdentifier(input.parentMessageId),
      metadata: sanitizeMetadata(input.metadata),
      createdAt: now,
    };
    await this.repository.appendMessage(message);
    await this.repository.updateConversation({ ...conversation, updatedAt: now, lastMessageAt: now });
    return message;
  }

  /** 修改标题；历史内容和摘要不受影响。 */
  public async rename(ownerUserId: string, conversationId: string, title: string): Promise<Conversation> {
    return this.update(ownerUserId, conversationId, { title: normalizeTitle(title) });
  }

  /** 设置置顶状态；只影响列表排序。 */
  public async setPinned(ownerUserId: string, conversationId: string, pinned: boolean): Promise<Conversation> {
    return this.update(ownerUserId, conversationId, { pinned });
  }

  /** 归档会话；归档后不能追加消息，但原始历史仍可恢复。 */
  public async archive(ownerUserId: string, conversationId: string): Promise<Conversation> {
    return this.update(ownerUserId, conversationId, { status: "archived", pinned: false });
  }

  /** 恢复归档会话。 */
  public async restore(ownerUserId: string, conversationId: string): Promise<Conversation> {
    return this.update(ownerUserId, conversationId, { status: "active" });
  }

  /** 软删除会话；物理清理由独立数据保留任务执行，防止破坏审计关联。 */
  public async remove(ownerUserId: string, conversationId: string): Promise<void> {
    await this.update(ownerUserId, conversationId, { status: "deleted", pinned: false });
  }

  private async update(ownerUserId: string, conversationId: string, patch: Partial<Conversation>): Promise<Conversation> {
    const conversation = await this.requireConversation(ownerUserId, conversationId);
    if (conversation.status === "deleted") throw new NotFoundError("会话不存在");
    const updated = { ...conversation, ...patch, id: conversation.id, ownerUserId: conversation.ownerUserId, updatedAt: new Date().toISOString() };
    await this.repository.updateConversation(updated);
    return updated;
  }

  private async requireConversation(ownerUserId: string, conversationId: string): Promise<Conversation> {
    const owner = requireIdentifier(ownerUserId, "用户");
    const id = requireIdentifier(conversationId, "会话");
    const conversation = await this.repository.getConversation(id, owner);
    if (!conversation) throw new NotFoundError("会话不存在");
    return conversation;
  }
}

function normalizeTitle(value: string): string {
  const title = value.replace(/\s+/g, " ").trim();
  if (!title) throw new ValidationError("会话标题不能为空");
  if (title.length > 120) throw new ValidationError("会话标题不能超过 120 个字符");
  return title;
}

function requireIdentifier(value: string, label: string): string {
  const id = value.trim();
  if (!id || id.length > 200) throw new ValidationError(`${label} ID 无效`);
  return id;
}

function optionalIdentifier(value: string | undefined): string | null {
  if (value === undefined) return null;
  const id = value.trim();
  if (!id || id.length > 200) throw new ValidationError("资源 ID 无效");
  return id;
}

function sanitizeMetadata(value: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!value) return {};
  const serialized = JSON.stringify(value);
  if (serialized.length > 20_000) throw new ValidationError("消息元数据过大");
  return JSON.parse(serialized) as Record<string, unknown>;
}

