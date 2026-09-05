import type { KnowledgeTask, KnowledgeTaskEvent } from "@/lib/domain/agents";

/** 任务仓储只暴露 owner 过滤后的任务和追加式事件，不允许通过任务 ID 越权读取。 */
export interface KnowledgeTaskRepository {
  createTask(task: KnowledgeTask): Promise<void>;
  getTask(taskId: string, ownerUserId: string): Promise<KnowledgeTask | null>;
  listTasks(ownerUserId: string, reportId?: string): Promise<KnowledgeTask[]>;
  updateTask(task: KnowledgeTask): Promise<void>;
  appendEvent(event: KnowledgeTaskEvent): Promise<void>;
  listEvents(taskId: string, ownerUserId: string): Promise<KnowledgeTaskEvent[]>;
}
