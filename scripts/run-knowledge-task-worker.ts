import { randomUUID } from "node:crypto";

import { getResearchRepository } from "@/lib/providers/repository-factory";
import { getKnowledgeTaskRepository } from "@/lib/repositories/agents/repository-factory";
import { getPlatformRepository } from "@/lib/repositories/platform/platform-repository-factory";
import { KnowledgeTaskService } from "@/lib/services/agents/knowledge-task-service";

/** PostgreSQL-backed one-shot Worker；任务租约过期后可被下一实例重新领取，结果只通过任务服务写入。 */
async function run(): Promise<void> {
  const repository = getKnowledgeTaskRepository();
  const workerId = `knowledge-worker-${randomUUID()}`;
  const task = await repository.claimNextQueued(workerId, 60_000);
  if (!task) { console.log(JSON.stringify({ type: "knowledge_task_idle", processed: 0 })); return; }
  try {
    const completed = await new KnowledgeTaskService(repository, getResearchRepository(), undefined, getPlatformRepository()).executeClaimed(task, workerId);
    console.log(JSON.stringify({ type: "knowledge_task_processed", taskId: completed.id, status: completed.status }));
  } catch (error) {
    console.error(JSON.stringify({ type: "knowledge_task_error", taskId: task.id, error: error instanceof Error ? error.message : "任务执行失败" }));
    process.exitCode = 1;
  }
}

run().catch((error) => { console.error(error instanceof Error ? error.message : "Knowledge Task Worker 启动失败"); process.exitCode = 1; });
