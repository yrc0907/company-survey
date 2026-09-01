import postgres, { type Sql } from "postgres";

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

type Row = Record<string, unknown>;

/** PostgreSQL 生产仓储；只执行固定表和固定字段 SQL，owner 过滤始终在查询内完成。 */
export class PostgresMemoryRepository implements MemoryRepository {
  public constructor(private readonly sql: Sql) {}

  /** 使用受控连接串创建小连接池，适配当前 2C2G 单机部署。 */
  public static fromConnectionString(connectionString: string): PostgresMemoryRepository {
    return new PostgresMemoryRepository(postgres(connectionString, { max: 3, idle_timeout: 20 }));
  }

  public async createConversation(value: Conversation): Promise<void> {
    await this.sql`INSERT INTO ai_conversation
      (id, owner_user_id, project_id, branch_id, parent_conversation_id, parent_message_id, title, status, pinned, summary_version, created_at, updated_at, last_message_at)
      VALUES (${value.id}, ${value.ownerUserId}, ${value.projectId}, ${value.branchId}, ${value.parentConversationId}, ${value.parentMessageId}, ${value.title}, ${value.status}, ${value.pinned}, ${value.summaryVersion}, ${value.createdAt}, ${value.updatedAt}, ${value.lastMessageAt})`;
  }

  public async getConversation(id: string, ownerUserId: string): Promise<Conversation | null> {
    const rows = await this.sql<Row[]>`SELECT * FROM ai_conversation WHERE id = ${id} AND owner_user_id = ${ownerUserId} LIMIT 1`;
    return rows[0] ? mapConversation(rows[0]) : null;
  }

  public async listConversations(query: ConversationQuery): Promise<Conversation[]> {
    const status = query.status ?? null;
    const projectId = query.projectId ?? null;
    const needle = query.query?.trim() ?? "";
    const rows = await this.sql<Row[]>`SELECT conversation.* FROM ai_conversation AS conversation
      WHERE conversation.owner_user_id = ${query.ownerUserId}
        AND (${status}::text IS NULL OR conversation.status = ${status})
        AND (${projectId}::text IS NULL OR conversation.project_id = ${projectId})
        AND (
          ${needle} = ''
          OR to_tsvector('simple', conversation.title) @@ plainto_tsquery('simple', ${needle})
          OR EXISTS (
            SELECT 1 FROM ai_conversation_message AS message
            WHERE message.conversation_id = conversation.id
              AND to_tsvector('simple', message.content) @@ plainto_tsquery('simple', ${needle})
          )
        )
      ORDER BY conversation.pinned DESC, conversation.updated_at DESC
      LIMIT ${query.limit} OFFSET ${query.offset}`;
    return rows.map(mapConversation);
  }

  public async updateConversation(value: Conversation): Promise<void> {
    await this.sql`UPDATE ai_conversation SET
      project_id = ${value.projectId}, branch_id = ${value.branchId}, title = ${value.title}, status = ${value.status},
      pinned = ${value.pinned}, summary_version = ${value.summaryVersion}, updated_at = ${value.updatedAt}, last_message_at = ${value.lastMessageAt}
      WHERE id = ${value.id} AND owner_user_id = ${value.ownerUserId}`;
  }

  public async appendMessage(value: ConversationMessage): Promise<void> {
    await this.sql`INSERT INTO ai_conversation_message
      (id, conversation_id, sequence, role, content, token_estimate, parent_message_id, metadata, created_at)
      VALUES (${value.id}, ${value.conversationId}, ${value.sequence}, ${value.role}, ${value.content}, ${value.tokenEstimate}, ${value.parentMessageId}, ${JSON.stringify(value.metadata)}::jsonb, ${value.createdAt})`;
  }

  public async listMessages(conversationId: string, ownerUserId: string): Promise<ConversationMessage[]> {
    const rows = await this.sql<Row[]>`SELECT message.* FROM ai_conversation_message AS message
      JOIN ai_conversation AS conversation ON conversation.id = message.conversation_id
      WHERE message.conversation_id = ${conversationId} AND conversation.owner_user_id = ${ownerUserId}
      ORDER BY message.sequence`;
    return rows.map(mapMessage);
  }

  public async listTools(conversationId: string, ownerUserId: string): Promise<ToolExecution[]> {
    const rows = await this.sql<Row[]>`SELECT tool.* FROM ai_tool_execution AS tool
      JOIN ai_conversation AS conversation ON conversation.id = tool.conversation_id
      WHERE tool.conversation_id = ${conversationId} AND conversation.owner_user_id = ${ownerUserId}
      ORDER BY tool.created_at`;
    return rows.map(mapTool);
  }

  public async insertTool(value: ToolExecution): Promise<void> {
    const callRows = await this.sql<Row[]>`SELECT id, role FROM ai_conversation_message
      WHERE id = ${value.callMessageId} AND conversation_id = ${value.conversationId} LIMIT 1`;
    const call = callRows[0];
    if (!call || (call.role !== "assistant" && call.role !== "system")) throw new Error("工具调用消息无效");
    if (value.resultMessageId) {
      const resultRows = await this.sql<Row[]>`SELECT id, role FROM ai_conversation_message
        WHERE id = ${value.resultMessageId} AND conversation_id = ${value.conversationId} LIMIT 1`;
      if (!resultRows[0] || resultRows[0].role !== "tool") throw new Error("工具结果消息无效");
    } else if (value.status !== "requested") {
      throw new Error("已结束的工具调用必须包含结果消息");
    }
    await this.sql`INSERT INTO ai_tool_execution
      (id, conversation_id, call_message_id, result_message_id, tool_name, arguments_hash, status, result_reference, created_at, completed_at)
      VALUES (${value.id}, ${value.conversationId}, ${value.callMessageId}, ${value.resultMessageId}, ${value.toolName}, ${value.argumentsHash}, ${value.status}, ${value.resultReference}, ${value.createdAt}, ${value.completedAt})`;
  }

  public async updateTool(value: ToolExecution): Promise<void> {
    if (value.resultMessageId) {
      const resultRows = await this.sql<Row[]>`SELECT id, role FROM ai_conversation_message
        WHERE id = ${value.resultMessageId} AND conversation_id = ${value.conversationId} LIMIT 1`;
      if (!resultRows[0] || resultRows[0].role !== "tool") throw new Error("工具结果消息无效");
    } else if (value.status !== "requested") {
      throw new Error("已结束的工具调用必须包含结果消息");
    }
    await this.sql`UPDATE ai_tool_execution SET result_message_id = ${value.resultMessageId}, status = ${value.status}, result_reference = ${value.resultReference}, completed_at = ${value.completedAt}
      WHERE id = ${value.id} AND conversation_id = ${value.conversationId}`;
  }

  public async insertCheckpoint(value: ConversationCheckpoint): Promise<void> {
    await this.sql`INSERT INTO ai_conversation_checkpoint
      (id, conversation_id, summary_id, source_start_sequence, source_end_sequence, token_before, token_after, status, failure_code, created_at, completed_at)
      VALUES (${value.id}, ${value.conversationId}, ${value.summaryId}, ${value.sourceStartSequence}, ${value.sourceEndSequence}, ${value.tokenBefore}, ${value.tokenAfter}, ${value.status}, ${value.failureCode}, ${value.createdAt}, ${value.completedAt})`;
  }

  public async updateCheckpoint(value: ConversationCheckpoint): Promise<void> {
    await this.sql`UPDATE ai_conversation_checkpoint SET summary_id = ${value.summaryId}, token_after = ${value.tokenAfter}, status = ${value.status}, failure_code = ${value.failureCode}, completed_at = ${value.completedAt}
      WHERE id = ${value.id} AND conversation_id = ${value.conversationId}`;
  }

  /**
   * 以数据库事务提交压缩结果：摘要、检查点和会话 summary_version 要么全部可见，要么全部回滚。
   * 会话行加锁并校验版本，避免两个并发压缩任务写出同一个摘要版本或孤儿摘要。
   */
  public async commitCompaction(input: { conversation: Conversation; summary: ConversationSummary; checkpoint: ConversationCheckpoint }): Promise<void> {
    await this.sql.begin(async (transaction) => {
      const rows = await transaction<Row[]>`SELECT id, owner_user_id, summary_version
        FROM ai_conversation
        WHERE id = ${input.conversation.id} AND owner_user_id = ${input.conversation.ownerUserId}
        FOR UPDATE`;
      const conversation = rows[0];
      if (!conversation) throw new Error("会话不存在");
      if (Number(conversation.summary_version) + 1 !== input.summary.version) throw new Error("压缩摘要版本不是当前会话的下一个版本");

      const checkpointRows = await transaction<Row[]>`SELECT id FROM ai_conversation_checkpoint
        WHERE id = ${input.checkpoint.id} AND conversation_id = ${input.conversation.id} AND status = 'started'
        FOR UPDATE`;
      if (!checkpointRows[0]) throw new Error("压缩检查点不存在或已提交");
      if (input.summary.conversationId !== input.conversation.id || input.checkpoint.conversationId !== input.conversation.id) throw new Error("压缩对象会话不一致");
      if (input.checkpoint.summaryId !== input.summary.id || input.checkpoint.status !== "completed") throw new Error("压缩检查点未正确闭合");

      await transaction`INSERT INTO ai_conversation_summary
        (id, conversation_id, version, structured_summary, source_start_sequence, source_end_sequence, source_message_ids, provider, model, created_at)
        VALUES (${input.summary.id}, ${input.summary.conversationId}, ${input.summary.version}, ${JSON.stringify(input.summary.structured)}::jsonb, ${input.summary.sourceStartSequence}, ${input.summary.sourceEndSequence}, ${transaction.array(input.summary.sourceMessageIds)}::text[], ${input.summary.provider}, ${input.summary.model}, ${input.summary.createdAt})`;
      await transaction`UPDATE ai_conversation_checkpoint SET summary_id = ${input.checkpoint.summaryId}, token_after = ${input.checkpoint.tokenAfter}, status = ${input.checkpoint.status}, failure_code = ${input.checkpoint.failureCode}, completed_at = ${input.checkpoint.completedAt}
        WHERE id = ${input.checkpoint.id} AND conversation_id = ${input.conversation.id}`;
      await transaction`UPDATE ai_conversation SET summary_version = ${input.conversation.summaryVersion}, updated_at = ${input.conversation.updatedAt}, last_message_at = ${input.conversation.lastMessageAt}
        WHERE id = ${input.conversation.id} AND owner_user_id = ${input.conversation.ownerUserId}`;
    });
  }

  public async listCheckpoints(conversationId: string, ownerUserId: string): Promise<ConversationCheckpoint[]> {
    const rows = await this.sql<Row[]>`SELECT checkpoint.* FROM ai_conversation_checkpoint AS checkpoint
      JOIN ai_conversation AS conversation ON conversation.id = checkpoint.conversation_id
      WHERE checkpoint.conversation_id = ${conversationId} AND conversation.owner_user_id = ${ownerUserId}
      ORDER BY checkpoint.created_at`;
    return rows.map(mapCheckpoint);
  }

  public async insertSummary(value: ConversationSummary): Promise<void> {
    await this.sql`INSERT INTO ai_conversation_summary
      (id, conversation_id, version, structured_summary, source_start_sequence, source_end_sequence, source_message_ids, provider, model, created_at)
      VALUES (${value.id}, ${value.conversationId}, ${value.version}, ${JSON.stringify(value.structured)}::jsonb, ${value.sourceStartSequence}, ${value.sourceEndSequence}, ${this.sql.array(value.sourceMessageIds)}::text[], ${value.provider}, ${value.model}, ${value.createdAt})`;
  }

  public async getLatestSummary(conversationId: string, ownerUserId: string): Promise<ConversationSummary | null> {
    const rows = await this.sql<Row[]>`SELECT summary.* FROM ai_conversation_summary AS summary
      JOIN ai_conversation AS conversation ON conversation.id = summary.conversation_id
      WHERE summary.conversation_id = ${conversationId} AND conversation.owner_user_id = ${ownerUserId}
      ORDER BY summary.version DESC LIMIT 1`;
    return rows[0] ? mapSummary(rows[0]) : null;
  }

  public async insertContextSnapshot(value: ContextSnapshot): Promise<void> {
    await this.sql`INSERT INTO ai_context_snapshot
      (id, conversation_id, request_message_id, scope, project_id, branch_id, file_id, folder_id, selected_message_ids, selected_chunk_ids, selected_memory_ids, summary_id, token_budget, model, created_at)
      VALUES (${value.id}, ${value.conversationId}, ${value.requestMessageId}, ${value.scope}, ${value.projectId}, ${value.branchId}, ${value.fileId}, ${value.folderId}, ${this.sql.array(value.selectedMessageIds)}::text[], ${this.sql.array(value.selectedChunkIds)}::text[], ${this.sql.array(value.selectedMemoryIds)}::text[], ${value.summaryId}, ${JSON.stringify(value.tokenBudget)}::jsonb, ${value.model}, ${value.createdAt})`;
  }

  public async insertAiPatch(value: AiPatch): Promise<void> {
    await this.sql`INSERT INTO ai_patch
      (id, conversation_id, message_id, branch_id, base_revision_id, patch, status, confirmed_by_user_id, merge_request_id, created_at, confirmed_at)
      VALUES (${value.id}, ${value.conversationId}, ${value.messageId}, ${value.branchId}, ${value.baseRevisionId}, ${JSON.stringify(value.patch)}::jsonb, ${value.status}, ${value.confirmedByUserId}, ${value.mergeRequestId}, ${value.createdAt}, ${value.confirmedAt})`;
  }

  public async createMemory(item: MemoryItem, version: MemoryVersion, sources: MemorySource[]): Promise<void> {
    await this.sql.begin(async (transaction) => {
      await transaction`INSERT INTO ai_memory_item
        (id, owner_user_id, project_id, scope, conversation_id, category, state, importance, confidence, valid_from, valid_until, current_version, created_at, updated_at)
        VALUES (${item.id}, ${item.ownerUserId}, ${item.projectId}, ${item.scope}, ${item.conversationId}, ${item.category}, ${item.state}, ${item.importance}, ${item.confidence}, ${item.validFrom}, ${item.validUntil}, ${item.currentVersion}, ${item.createdAt}, ${item.updatedAt})`;
      await transaction`INSERT INTO ai_memory_version
        (id, memory_item_id, version, content, normalized_content, reason, supersedes_version_id, created_by_user_id, created_at)
        VALUES (${version.id}, ${version.memoryItemId}, ${version.version}, ${version.content}, ${version.normalizedContent}, ${version.reason}, ${version.supersedesVersionId}, ${version.createdByUserId}, ${version.createdAt})`;
      for (const source of sources) {
        await transaction`INSERT INTO ai_memory_source
          (id, memory_version_id, source_type, source_id, extraction_mode, created_at)
          VALUES (${source.id}, ${source.memoryVersionId}, ${source.sourceType}, ${source.sourceId}, ${source.extractionMode}, ${source.createdAt})`;
      }
    });
  }

  public async getMemory(id: string, ownerUserId: string): Promise<MemoryCandidate | null> {
    const rows = await this.sql<Row[]>`SELECT item.*, version.id AS version_id, version.version AS version_number,
      version.content, version.normalized_content, version.reason, version.supersedes_version_id, version.created_by_user_id,
      version.created_at AS version_created_at
      FROM ai_memory_item AS item
      JOIN ai_memory_version AS version ON version.memory_item_id = item.id AND version.version = item.current_version
      WHERE item.id = ${id} AND item.owner_user_id = ${ownerUserId} LIMIT 1`;
    if (!rows[0]) return null;
    return this.attachSources(mapMemoryCandidate(rows[0]));
  }

  public async updateMemory(item: MemoryItem, version?: MemoryVersion, sources: MemorySource[] = []): Promise<void> {
    await this.sql.begin(async (transaction) => {
      await transaction`UPDATE ai_memory_item SET state = ${item.state}, importance = ${item.importance}, confidence = ${item.confidence}, valid_until = ${item.validUntil}, current_version = ${item.currentVersion}, updated_at = ${item.updatedAt}
        WHERE id = ${item.id} AND owner_user_id = ${item.ownerUserId}`;
      if (version) {
        await transaction`INSERT INTO ai_memory_version
          (id, memory_item_id, version, content, normalized_content, reason, supersedes_version_id, created_by_user_id, created_at)
          VALUES (${version.id}, ${version.memoryItemId}, ${version.version}, ${version.content}, ${version.normalizedContent}, ${version.reason}, ${version.supersedesVersionId}, ${version.createdByUserId}, ${version.createdAt})`;
        for (const source of sources) {
          await transaction`INSERT INTO ai_memory_source
            (id, memory_version_id, source_type, source_id, extraction_mode, created_at)
            VALUES (${source.id}, ${source.memoryVersionId}, ${source.sourceType}, ${source.sourceId}, ${source.extractionMode}, ${source.createdAt})`;
        }
      }
    });
  }

  public async listMemories(query: MemoryQuery): Promise<MemoryCandidate[]> {
    return this.queryMemories(query, false);
  }

  public async searchMemories(query: MemoryQuery): Promise<MemoryCandidate[]> {
    return this.queryMemories(query, true);
  }

  /** 权限和时效过滤先于 FTS；缺少 project/conversation 时对应作用域不会被召回。 */
  private async queryMemories(query: MemoryQuery, requireMatch: boolean): Promise<MemoryCandidate[]> {
    const rows = await this.sql<Row[]>`SELECT item.*, version.id AS version_id, version.version AS version_number,
      version.content, version.normalized_content, version.reason, version.supersedes_version_id, version.created_by_user_id,
      version.created_at AS version_created_at,
      ts_rank_cd(to_tsvector('simple', version.normalized_content), plainto_tsquery('simple', ${query.query})) AS lexical_rank
      FROM ai_memory_item AS item
      JOIN ai_memory_version AS version ON version.memory_item_id = item.id AND version.version = item.current_version
      WHERE item.owner_user_id = ${query.ownerUserId}
        AND item.state = 'active'
        AND (item.valid_until IS NULL OR item.valid_until > ${query.now})
        AND (
          item.scope = 'user'
          OR (item.scope = 'project' AND ${query.projectId}::text IS NOT NULL AND item.project_id = ${query.projectId})
          OR (item.scope = 'conversation' AND ${query.conversationId}::text IS NOT NULL AND item.conversation_id = ${query.conversationId})
        )
        AND (${requireMatch} = FALSE OR to_tsvector('simple', version.normalized_content) @@ plainto_tsquery('simple', ${query.query}))
      ORDER BY lexical_rank DESC, item.importance DESC, item.confidence DESC, item.updated_at DESC
      LIMIT ${query.limit}`;
    return Promise.all(rows.map((row) => this.attachSources(mapMemoryCandidate(row))));
  }

  private async attachSources(candidate: MemoryCandidate): Promise<MemoryCandidate> {
    const rows = await this.sql<Row[]>`SELECT * FROM ai_memory_source WHERE memory_version_id = ${candidate.version.id} ORDER BY created_at`;
    return { ...candidate, sources: rows.map(mapMemorySource) };
  }
}

function mapConversation(row: Row): Conversation {
  return {
    id: String(row.id), ownerUserId: String(row.owner_user_id), projectId: nullable(row.project_id), branchId: nullable(row.branch_id),
    parentConversationId: nullable(row.parent_conversation_id), parentMessageId: nullable(row.parent_message_id), title: String(row.title),
    status: row.status as Conversation["status"], pinned: Boolean(row.pinned), summaryVersion: Number(row.summary_version),
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), lastMessageAt: nullableIso(row.last_message_at),
  };
}

function mapMessage(row: Row): ConversationMessage {
  return {
    id: String(row.id), conversationId: String(row.conversation_id), sequence: Number(row.sequence), role: row.role as ConversationMessage["role"],
    content: String(row.content), tokenEstimate: Number(row.token_estimate), parentMessageId: nullable(row.parent_message_id),
    metadata: (row.metadata as Record<string, unknown>) ?? {}, createdAt: iso(row.created_at),
  };
}

function mapTool(row: Row): ToolExecution {
  return {
    id: String(row.id), conversationId: String(row.conversation_id), callMessageId: String(row.call_message_id), resultMessageId: nullable(row.result_message_id),
    toolName: String(row.tool_name), argumentsHash: String(row.arguments_hash), status: row.status as ToolExecution["status"],
    resultReference: nullable(row.result_reference), createdAt: iso(row.created_at), completedAt: nullableIso(row.completed_at),
  };
}

function mapCheckpoint(row: Row): ConversationCheckpoint {
  return {
    id: String(row.id), conversationId: String(row.conversation_id), summaryId: nullable(row.summary_id),
    sourceStartSequence: Number(row.source_start_sequence), sourceEndSequence: Number(row.source_end_sequence), tokenBefore: Number(row.token_before),
    tokenAfter: row.token_after === null ? null : Number(row.token_after), status: row.status as ConversationCheckpoint["status"],
    failureCode: nullable(row.failure_code), createdAt: iso(row.created_at), completedAt: nullableIso(row.completed_at),
  };
}

function mapSummary(row: Row): ConversationSummary {
  return {
    id: String(row.id), conversationId: String(row.conversation_id), version: Number(row.version),
    structured: row.structured_summary as ConversationSummary["structured"], sourceStartSequence: Number(row.source_start_sequence),
    sourceEndSequence: Number(row.source_end_sequence), sourceMessageIds: (row.source_message_ids as string[]) ?? [],
    provider: String(row.provider), model: String(row.model), createdAt: iso(row.created_at),
  };
}

function mapMemoryCandidate(row: Row): MemoryCandidate {
  const item: MemoryItem = {
    id: String(row.id), ownerUserId: String(row.owner_user_id), projectId: nullable(row.project_id), conversationId: nullable(row.conversation_id),
    scope: row.scope as MemoryItem["scope"], category: row.category as MemoryItem["category"], state: row.state as MemoryItem["state"],
    importance: Number(row.importance), confidence: Number(row.confidence), validFrom: iso(row.valid_from), validUntil: nullableIso(row.valid_until),
    currentVersion: Number(row.current_version), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  };
  const version: MemoryVersion = {
    id: String(row.version_id), memoryItemId: item.id, version: Number(row.version_number), content: String(row.content),
    normalizedContent: String(row.normalized_content), reason: String(row.reason), supersedesVersionId: nullable(row.supersedes_version_id),
    createdByUserId: String(row.created_by_user_id), createdAt: iso(row.version_created_at),
  };
  return { item, version, sources: [] };
}

function mapMemorySource(row: Row): MemorySource {
  return {
    id: String(row.id), memoryVersionId: String(row.memory_version_id), sourceType: row.source_type as MemorySource["sourceType"],
    sourceId: String(row.source_id), extractionMode: row.extraction_mode as MemorySource["extractionMode"], createdAt: iso(row.created_at),
  };
}

function nullable(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function nullableIso(value: unknown): string | null {
  return value === null || value === undefined ? null : iso(value);
}
