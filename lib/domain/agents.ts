/** Multi-Agent 任务的持久化状态；正式知识仍由报告、来源、版本和 Patch 领域对象负责。 */
export type KnowledgeTaskStatus = "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";
export type KnowledgeWorkflowType = "research" | "ingestion" | "editing" | "review" | "publishing" | "memory";
export type KnowledgeTaskNode = "queued" | "project_context" | "dispatch_agents" | "synthesize" | "human_approval" | "paused" | "completed" | "degraded" | "failed" | "cancelled";

export interface KnowledgeTaskCheckpoint {
  node: KnowledgeTaskNode;
  completedAgents: string[];
  stateVersion: number;
  savedAt: string;
}

export interface KnowledgeTask {
  id: string;
  ownerUserId: string;
  reportId: string;
  objective: string;
  workflowType?: KnowledgeWorkflowType;
  selectedAgents: string[];
  status: KnowledgeTaskStatus;
  currentNode: KnowledgeTaskNode;
  state: Record<string, unknown>;
  checkpoint?: KnowledgeTaskCheckpoint | null;
  leaseOwner?: string | null;
  leaseExpiresAt?: string | null;
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
