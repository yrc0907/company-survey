import assert from "node:assert/strict";

import { InMemoryKnowledgeTaskRepository } from "@/lib/repositories/agents/in-memory-knowledge-task-repository";
import { MemoryResearchRepository } from "@/lib/providers/research-repository";
import { createDemoSnapshot } from "@/lib/providers/seed";
import { KnowledgeTaskService } from "@/lib/services/agents/knowledge-task-service";

const provider = { complete: async () => ({ status: "completed" as const, reason: "contract", answer: "可验证回答" }) };

async function run(): Promise<void> {
  const repository = new InMemoryKnowledgeTaskRepository();
  const service = new KnowledgeTaskService(repository, new MemoryResearchRepository(createDemoSnapshot), provider);
  const created = await service.createAndRun({ reportId: "report-huice", projectId: "project-huice", scope: "current_project", question: "检查证据并改写摘要" }, "user-a");
  assert.equal(created.status, "completed");
  assert.deepEqual(created.selectedAgents, ["research", "writing", "review"]);
  assert.equal((await service.get(created.id, "user-b")), null);
  const detail = await service.get(created.id, "user-a");
  assert.ok(detail);
  assert.ok(detail.events.length >= 4, "任务应记录排队、领取、检查点和完成事件");
  assert.equal(detail.events[0]?.status, "queued");
  assert.equal(detail.events.at(-1)?.status, "completed");

  const cancelled = { id: "cancel-me", ownerUserId: "user-a", reportId: "report-huice", objective: "待处理", selectedAgents: ["research"], status: "paused" as const, currentNode: "human_approval" as const, state: {}, result: null, error: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), completedAt: null };
  await repository.createTask(cancelled);
  const cancelledResult = await service.cancel(cancelled.id, "user-a");
  assert.equal(cancelledResult?.status, "cancelled");

  const paused = await service.create({ reportId: "report-huice", projectId: "project-huice", scope: "current_project", question: "整理当前报告" }, "user-a");
  assert.equal((await service.pause(paused.id, "user-a"))?.status, "paused");
  assert.equal((await service.resume(paused.id, "user-a"))?.status, "completed");

  const workerTask = await service.create({ reportId: "report-huice", projectId: "project-huice", scope: "current_project", question: "提取事实 Claim 并准备发布说明" }, "user-a");
  const worker = await repository.claimNextQueued("worker-a", 60_000);
  assert.equal(worker?.id, workerTask.id);
  assert.equal(await repository.claimTask(workerTask.id, "user-a", "worker-b", 60_000), null, "同一任务不能被第二个 Worker 抢占");
  assert.deepEqual((await new KnowledgeTaskService(repository, new MemoryResearchRepository(createDemoSnapshot), provider).executeClaimed(worker!, "worker-a")).status, "completed");
}

run().then(() => console.log("knowledge-task-service contract passed"));
