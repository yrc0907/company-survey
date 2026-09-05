/** Multi-Agent 任务的持久化状态；正式知识仍由报告、来源、版本和 Patch 领域对象负责。 */
export type KnowledgeTaskStatus = "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";

export interface KnowledgeTask {
  id: string;
  ownerUserId: string;
  reportId: string;
  objective: string;
  selectedAgents: string[];
  status: KnowledgeTaskStatus;
  currentNode: string;
  state: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface KnowledgeTaskEvent {
  id: string;
  taskId: string;
  node: string;
  status: KnowledgeTaskStatus;
  payload: Record<string, unknown>;
  createdAt: string;
}
