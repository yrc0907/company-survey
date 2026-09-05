import postgres, { type Sql } from "postgres";

import type { KnowledgeTask, KnowledgeTaskEvent } from "@/lib/domain/agents";
import type { KnowledgeTaskRepository } from "@/lib/repositories/agents/knowledge-task-repository";

type TaskRow = Record<string, unknown>;

/** PostgreSQL 任务仓储；所有读取都在 SQL 层绑定 owner，事件只追加不覆盖。 */
export class PostgresKnowledgeTaskRepository implements KnowledgeTaskRepository {
  public constructor(private readonly sql: Sql) {}

  public static fromConnectionString(connectionString: string): PostgresKnowledgeTaskRepository {
    return new PostgresKnowledgeTaskRepository(postgres(connectionString, { max: 8, idle_timeout: 20, connect_timeout: 10 }));
  }

  public async createTask(task: KnowledgeTask): Promise<void> {
    await this.sql`INSERT INTO ai_knowledge_task
      (id, owner_user_id, report_id, objective, selected_agents, status, current_node, state, result, error, created_at, updated_at, completed_at)
      VALUES (${task.id}, ${task.ownerUserId}, ${task.reportId}, ${task.objective}, ${this.sql.array(task.selectedAgents)}, ${task.status}, ${task.currentNode}, ${JSON.stringify(task.state)}::jsonb, ${task.result ? JSON.stringify(task.result) : null}::jsonb, ${task.error}, ${task.createdAt}, ${task.updatedAt}, ${task.completedAt})`;
  }

  public async getTask(taskId: string, ownerUserId: string): Promise<KnowledgeTask | null> {
    const rows = await this.sql<TaskRow[]>`SELECT * FROM ai_knowledge_task WHERE id = ${taskId} AND owner_user_id = ${ownerUserId} LIMIT 1`;
    return rows[0] ? mapTask(rows[0]) : null;
  }

  public async listTasks(ownerUserId: string, reportId?: string): Promise<KnowledgeTask[]> {
    const rows = reportId
      ? await this.sql<TaskRow[]>`SELECT * FROM ai_knowledge_task WHERE owner_user_id = ${ownerUserId} AND report_id = ${reportId} ORDER BY created_at DESC`
      : await this.sql<TaskRow[]>`SELECT * FROM ai_knowledge_task WHERE owner_user_id = ${ownerUserId} ORDER BY created_at DESC`;
    return rows.map(mapTask);
  }

  public async updateTask(task: KnowledgeTask): Promise<void> {
    await this.sql`UPDATE ai_knowledge_task SET selected_agents = ${this.sql.array(task.selectedAgents)}, status = ${task.status}, current_node = ${task.currentNode}, state = ${JSON.stringify(task.state)}::jsonb, result = ${task.result ? JSON.stringify(task.result) : null}::jsonb, error = ${task.error}, updated_at = ${task.updatedAt}, completed_at = ${task.completedAt} WHERE id = ${task.id} AND owner_user_id = ${task.ownerUserId}`;
  }

  public async appendEvent(event: KnowledgeTaskEvent): Promise<void> {
    await this.sql`INSERT INTO ai_knowledge_task_event (id, task_id, node, status, payload, created_at) VALUES (${event.id}, ${event.taskId}, ${event.node}, ${event.status}, ${JSON.stringify(event.payload)}::jsonb, ${event.createdAt})`;
  }

  public async listEvents(taskId: string, ownerUserId: string): Promise<KnowledgeTaskEvent[]> {
    const rows = await this.sql<TaskRow[]>`SELECT event.* FROM ai_knowledge_task_event AS event JOIN ai_knowledge_task AS task ON task.id = event.task_id WHERE event.task_id = ${taskId} AND task.owner_user_id = ${ownerUserId} ORDER BY event.created_at ASC`;
    return rows.map(mapEvent);
  }
}

function mapTask(row: TaskRow): KnowledgeTask {
  return {
    id: String(row.id), ownerUserId: String(row.owner_user_id), reportId: String(row.report_id), objective: String(row.objective),
    selectedAgents: Array.isArray(row.selected_agents) ? row.selected_agents.map(String) : [], status: String(row.status) as KnowledgeTask["status"],
    currentNode: String(row.current_node), state: asRecord(row.state), result: row.result ? asRecord(row.result) : null, error: row.error ? String(row.error) : null,
    createdAt: new Date(String(row.created_at)).toISOString(), updatedAt: new Date(String(row.updated_at)).toISOString(), completedAt: row.completed_at ? new Date(String(row.completed_at)).toISOString() : null,
  };
}

function mapEvent(row: TaskRow): KnowledgeTaskEvent {
  return { id: String(row.id), taskId: String(row.task_id), node: String(row.node), status: String(row.status) as KnowledgeTaskEvent["status"], payload: asRecord(row.payload), createdAt: new Date(String(row.created_at)).toISOString() };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
