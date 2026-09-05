import type { KnowledgeTask, KnowledgeTaskEvent } from "@/lib/domain/agents";
import type { KnowledgeTaskRepository } from "@/lib/repositories/agents/knowledge-task-repository";

/** 测试和本地组合根使用的任务仓储；返回值深复制，避免调用方绕过状态机修改记录。 */
export class InMemoryKnowledgeTaskRepository implements KnowledgeTaskRepository {
  private readonly tasks = new Map<string, KnowledgeTask>();
  private readonly events = new Map<string, KnowledgeTaskEvent[]>();

  public async createTask(task: KnowledgeTask): Promise<void> {
    if (this.tasks.has(task.id)) throw new Error("任务 ID 已存在");
    this.tasks.set(task.id, structuredClone(task));
  }

  public async getTask(taskId: string, ownerUserId: string): Promise<KnowledgeTask | null> {
    const task = this.tasks.get(taskId);
    return task?.ownerUserId === ownerUserId ? structuredClone(task) : null;
  }

  public async listTasks(ownerUserId: string, reportId?: string): Promise<KnowledgeTask[]> {
    return structuredClone(Array.from(this.tasks.values())
      .filter((task) => task.ownerUserId === ownerUserId && (!reportId || task.reportId === reportId))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt)));
  }

  public async updateTask(task: KnowledgeTask): Promise<void> {
    const current = this.tasks.get(task.id);
    if (!current || current.ownerUserId !== task.ownerUserId) throw new Error("任务不存在");
    this.tasks.set(task.id, structuredClone(task));
  }

  public async appendEvent(event: KnowledgeTaskEvent): Promise<void> {
    if (!this.tasks.has(event.taskId)) throw new Error("任务不存在");
    const events = this.events.get(event.taskId) ?? [];
    if (events.some((item) => item.id === event.id)) throw new Error("任务事件 ID 已存在");
    events.push(structuredClone(event));
    this.events.set(event.taskId, events);
  }

  public async listEvents(taskId: string, ownerUserId: string): Promise<KnowledgeTaskEvent[]> {
    if (!(await this.getTask(taskId, ownerUserId))) return [];
    return structuredClone(this.events.get(taskId) ?? []);
  }

  public async claimTask(taskId: string, ownerUserId: string, leaseOwner: string, leaseMs: number): Promise<KnowledgeTask | null> {
    const task = await this.getTask(taskId, ownerUserId);
    if (!task || !isClaimable(task)) return null;
    return this.claim(task, leaseOwner, leaseMs);
  }

  public async claimNextQueued(leaseOwner: string, leaseMs: number): Promise<KnowledgeTask | null> {
    const task = Array.from(this.tasks.values()).sort((left, right) => left.createdAt.localeCompare(right.createdAt)).find(isClaimable);
    return task ? this.claim(task, leaseOwner, leaseMs) : null;
  }

  private claim(task: KnowledgeTask, leaseOwner: string, leaseMs: number): KnowledgeTask {
    const claimed = structuredClone({ ...task, status: "running" as const, currentNode: "project_context" as const, leaseOwner, leaseExpiresAt: new Date(Date.now() + leaseMs).toISOString(), updatedAt: new Date().toISOString() });
    this.tasks.set(task.id, claimed);
    return structuredClone(claimed);
  }
}

function isClaimable(task: KnowledgeTask): boolean {
  return (task.status === "queued" || task.status === "paused") || (task.status === "running" && Boolean(task.leaseExpiresAt && Date.parse(task.leaseExpiresAt) <= Date.now()));
}
