import { randomUUID } from "node:crypto";

import type { KnowledgeTask, KnowledgeTaskEvent } from "@/lib/domain/agents";
import type { ContextProjectionInput } from "@/lib/services/context-projection-service";
import type { KnowledgeTaskRepository } from "@/lib/repositories/agents/knowledge-task-repository";
import { classifyKnowledgeWorkflow, KnowledgeAgentService, routeKnowledgeAgents } from "@/lib/services/agents/knowledge-agent-service";
import type { ResearchRepository } from "@/lib/providers/research-repository";
import type { ModelProvider } from "@/lib/providers/model-provider";

/** 持久化并运行一次知识任务；状态变化和结果都记录为可恢复的任务事件。 */
export class KnowledgeTaskService {
  private readonly agents: KnowledgeAgentService;

  public constructor(private readonly repository: KnowledgeTaskRepository, researchRepository: ResearchRepository, modelProvider?: ModelProvider) {
    this.agents = new KnowledgeAgentService(researchRepository, modelProvider);
  }

  public async createAndRun(input: ContextProjectionInput, ownerUserId: string): Promise<KnowledgeTask> {
    const task = await this.create(input, ownerUserId);
    return this.execute(task.id, ownerUserId);
  }

  public async create(input: ContextProjectionInput, ownerUserId: string): Promise<KnowledgeTask> {
    const now = new Date().toISOString();
    const task: KnowledgeTask = {
      id: randomUUID(), ownerUserId, reportId: input.reportId, objective: input.question.trim(), selectedAgents: routeKnowledgeAgents(input.question),
      workflowType: classifyKnowledgeWorkflow(input.question), status: "queued", currentNode: "queued", state: { input, control: { pauseRequested: false }, budget: { maxSteps: 8, maxAgents: 5, timeoutMs: 20_000 } }, checkpoint: null, leaseOwner: null, leaseExpiresAt: null, result: null, error: null, createdAt: now, updatedAt: now, completedAt: null,
    };
    await this.repository.createTask(task);
    await this.record(task, "queued", { selectedAgents: task.selectedAgents });
    return task;
  }

  public async get(taskId: string, ownerUserId: string): Promise<{ task: KnowledgeTask; events: KnowledgeTaskEvent[] } | null> {
    const task = await this.repository.getTask(taskId, ownerUserId);
    if (!task) return null;
    return { task, events: await this.repository.listEvents(taskId, ownerUserId) };
  }

  public async list(ownerUserId: string, reportId?: string): Promise<KnowledgeTask[]> {
    return this.repository.listTasks(ownerUserId, reportId);
  }

  public async cancel(taskId: string, ownerUserId: string): Promise<KnowledgeTask | null> {
    const task = await this.repository.getTask(taskId, ownerUserId);
    if (!task) return null;
    if (task.status !== "queued" && task.status !== "paused") throw new Error("当前任务已经开始执行，不能取消");
    const cancelled = { ...task, status: "cancelled" as const, currentNode: "cancelled" as const, updatedAt: new Date().toISOString(), completedAt: new Date().toISOString() };
    await this.repository.updateTask(cancelled);
    await this.record(cancelled, "cancelled", {});
    return cancelled;
  }

  public async pause(taskId: string, ownerUserId: string): Promise<KnowledgeTask | null> {
    const task = await this.repository.getTask(taskId, ownerUserId);
    if (!task) return null;
    if (task.status !== "queued" && task.status !== "running") throw new Error("当前任务不可暂停");
    const paused = task.status === "running"
      ? { ...task, state: { ...task.state, control: { pauseRequested: true } }, updatedAt: new Date().toISOString() }
      : { ...task, status: "paused" as const, currentNode: "paused" as const, updatedAt: new Date().toISOString() };
    await this.repository.updateTask(paused);
    await this.record(paused, paused.status, { pauseRequested: task.status === "running" });
    return paused;
  }

  public async resume(taskId: string, ownerUserId: string): Promise<KnowledgeTask | null> {
    const task = await this.repository.getTask(taskId, ownerUserId);
    if (!task) return null;
    if (task.status !== "paused") throw new Error("只有已暂停的任务可以恢复");
    return this.execute(task.id, ownerUserId);
  }

  public async execute(taskId: string, ownerUserId: string): Promise<KnowledgeTask> {
    const task = await this.repository.getTask(taskId, ownerUserId);
    if (!task) throw new Error("任务不存在");
    if (task.status !== "queued" && task.status !== "paused") throw new Error("当前任务不可执行");
    const input = task.state.input;
    if (!input || typeof input !== "object") throw new Error("任务输入状态损坏");
    const workerId = `request-${randomUUID()}`;
    const claimed = await this.repository.claimTask(task.id, ownerUserId, workerId, 60_000);
    if (!claimed) throw new Error("任务已被其他 Worker 领取或状态已变化");
    return this.executeClaimed(claimed, workerId);
  }

  /** Worker 已经通过数据库原子领取任务后，从检查点继续执行。 */
  public async executeClaimed(task: KnowledgeTask, workerId: string): Promise<KnowledgeTask> {
    const input = task.state.input;
    if (task.status !== "running" || task.leaseOwner !== workerId || !input || typeof input !== "object") throw new Error("任务租约或输入状态无效");
    if (task.checkpoint?.node === "human_approval" && task.result) return this.resumeFromCheckpoint(task);
    return this.run(task, input as ContextProjectionInput, workerId);
  }

  private async resumeFromCheckpoint(task: KnowledgeTask): Promise<KnowledgeTask> {
    const completed = { ...task, status: "completed" as const, currentNode: "completed" as const, state: { ...task.state, control: { pauseRequested: false }, resumedFrom: task.checkpoint?.node }, checkpoint: { ...task.checkpoint!, node: "completed" as const, savedAt: new Date().toISOString() }, updatedAt: new Date().toISOString(), completedAt: new Date().toISOString(), leaseOwner: null, leaseExpiresAt: null };
    await this.repository.updateTask(completed);
    await this.record(completed, "completed", { resumedFrom: "human_approval", checkpointResume: true });
    return completed;
  }

  private async run(task: KnowledgeTask, input: ContextProjectionInput, workerId: string): Promise<KnowledgeTask> {
    const running = { ...task, status: "running" as const, currentNode: "project_context" as const, updatedAt: new Date().toISOString() };
    await this.repository.updateTask(running);
    await this.record(running, "running", { node: running.currentNode, workerId });
    try {
      await this.saveCheckpoint(running, "project_context", []);
      const result = await this.agents.run(input);
      const latest = await this.repository.getTask(task.id, task.ownerUserId);
      if (latest?.state.control && (latest.state.control as Record<string, unknown>).pauseRequested === true) {
        const paused = { ...latest, status: "paused" as const, currentNode: "human_approval" as const, state: { input, workflow: result.workflow, control: { pauseRequested: false, resumedFrom: "synthesize" } }, checkpoint: { node: "human_approval" as const, completedAgents: result.workflow.selectedAgents, stateVersion: 1, savedAt: new Date().toISOString() }, result: { answer: result.answer, context: result.context }, updatedAt: new Date().toISOString(), leaseOwner: null, leaseExpiresAt: null };
        await this.repository.updateTask(paused);
        await this.record(paused, "paused", { reason: "cooperative_pause", resumeFrom: "synthesize" });
        return paused;
      }
      const completed = { ...running, status: result.completion.status === "completed" ? "completed" as const : "failed" as const, currentNode: result.completion.status === "completed" ? "completed" as const : "degraded" as const, state: { input, workflow: result.workflow, control: { pauseRequested: false } }, checkpoint: { node: result.completion.status === "completed" ? "completed" as const : "degraded" as const, completedAgents: result.workflow.selectedAgents, stateVersion: 1, savedAt: new Date().toISOString() }, result: { answer: result.answer, context: result.context }, error: result.completion.status === "completed" ? null : result.completion.reason, updatedAt: new Date().toISOString(), completedAt: new Date().toISOString(), leaseOwner: null, leaseExpiresAt: null };
      await this.repository.updateTask(completed);
      await this.record(completed, completed.status, { selectedAgents: completed.selectedAgents, findingCount: result.workflow.findings.length });
      return completed;
    } catch (error) {
      const failed = { ...running, status: "failed" as const, currentNode: "failed" as const, error: error instanceof Error ? error.message : "任务执行失败", updatedAt: new Date().toISOString(), completedAt: new Date().toISOString(), leaseOwner: null, leaseExpiresAt: null };
      await this.repository.updateTask(failed);
      await this.record(failed, "failed", { error: failed.error });
      return failed;
    }
  }

  private async saveCheckpoint(task: KnowledgeTask, node: "project_context" | "dispatch_agents" | "synthesize", completedAgents: string[]): Promise<void> {
    const checkpoint = { node, completedAgents, stateVersion: 1, savedAt: new Date().toISOString() } as const;
    const updated = { ...task, currentNode: node, checkpoint, updatedAt: new Date().toISOString() };
    await this.repository.updateTask(updated);
    await this.record(updated, "running", { checkpoint: node, completedAgents });
  }

  private async record(task: KnowledgeTask, status: KnowledgeTask["status"], payload: Record<string, unknown>): Promise<void> {
    await this.repository.appendEvent({ id: randomUUID(), taskId: task.id, node: task.currentNode, status, payload, createdAt: new Date().toISOString() });
  }
}
