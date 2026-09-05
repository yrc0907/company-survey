import { randomUUID } from "node:crypto";

import type { KnowledgeTask, KnowledgeTaskEvent } from "@/lib/domain/agents";
import type { ContextProjectionInput } from "@/lib/services/context-projection-service";
import type { KnowledgeTaskRepository } from "@/lib/repositories/agents/knowledge-task-repository";
import { KnowledgeAgentService, routeKnowledgeAgents } from "@/lib/services/agents/knowledge-agent-service";
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
      status: "queued", currentNode: "queued", state: { input }, result: null, error: null, createdAt: now, updatedAt: now, completedAt: null,
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
    const cancelled = { ...task, status: "cancelled" as const, currentNode: "cancelled", updatedAt: new Date().toISOString(), completedAt: new Date().toISOString() };
    await this.repository.updateTask(cancelled);
    await this.record(cancelled, "cancelled", {});
    return cancelled;
  }

  public async pause(taskId: string, ownerUserId: string): Promise<KnowledgeTask | null> {
    const task = await this.repository.getTask(taskId, ownerUserId);
    if (!task) return null;
    if (task.status !== "queued") throw new Error("只有尚未执行的任务可以暂停");
    const paused = { ...task, status: "paused" as const, currentNode: "paused", updatedAt: new Date().toISOString() };
    await this.repository.updateTask(paused);
    await this.record(paused, "paused", {});
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
    return this.run(task, input as ContextProjectionInput);
  }

  private async run(task: KnowledgeTask, input: ContextProjectionInput): Promise<KnowledgeTask> {
    const running = { ...task, status: "running" as const, currentNode: "dispatch_agents", updatedAt: new Date().toISOString() };
    await this.repository.updateTask(running);
    await this.record(running, "running", { node: running.currentNode });
    try {
      const result = await this.agents.run(input);
      const completed = { ...running, status: result.completion.status === "completed" ? "completed" as const : "failed" as const, currentNode: result.completion.status === "completed" ? "completed" : "degraded", state: { input, workflow: result.workflow }, result: { answer: result.answer, context: result.context }, error: result.completion.status === "completed" ? null : result.completion.reason, updatedAt: new Date().toISOString(), completedAt: new Date().toISOString() };
      await this.repository.updateTask(completed);
      await this.record(completed, completed.status, { selectedAgents: completed.selectedAgents, findingCount: result.workflow.findings.length });
      return completed;
    } catch (error) {
      const failed = { ...running, status: "failed" as const, currentNode: "failed", error: error instanceof Error ? error.message : "任务执行失败", updatedAt: new Date().toISOString(), completedAt: new Date().toISOString() };
      await this.repository.updateTask(failed);
      await this.record(failed, "failed", { error: failed.error });
      return failed;
    }
  }

  private async record(task: KnowledgeTask, status: KnowledgeTask["status"], payload: Record<string, unknown>): Promise<void> {
    await this.repository.appendEvent({ id: randomUUID(), taskId: task.id, node: task.currentNode, status, payload, createdAt: new Date().toISOString() });
  }
}
