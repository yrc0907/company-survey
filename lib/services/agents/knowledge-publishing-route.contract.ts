import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

/** Publishing Agent 只能经人工确认出口创建 MR，并复用现有权限、幂等和任务所有者边界。 */
async function run(): Promise<void> {
  const source = await readFile("app/api/ai/tasks/[id]/publish/route.ts", "utf8");
  assert.match(source, /assertTrustedJsonRequest/);
  assert.match(source, /getTask\(context\.params\.id, actor\.userId\)/);
  assert.match(source, /task\.selectedAgents\.includes\("publishing"\)/);
  assert.match(source, /createMergeRequest/);
  assert.match(source, /autoMerge: false/);
  assert.match(source, /idempotencyKey: readIdempotencyKey/);
}

run().then(() => console.log("knowledge-publishing-route contract passed"));
