import assert from "node:assert/strict";

import { listKnowledgeAgents, routeKnowledgeAgents } from "@/lib/services/agents/knowledge-agent-service";

/** 验证动态路由覆盖平台级知识任务，而非只覆盖调研。 */
function run(): void {
  assert.deepEqual(listKnowledgeAgents().map((agent) => agent.name), ["research", "writing", "review", "memory"]);
  assert.deepEqual(routeKnowledgeAgents("查找当前报告的关键证据"), ["research", "review"]);
  assert.deepEqual(routeKnowledgeAgents("把当前章节改写成一段摘要"), ["research", "writing"]);
  assert.deepEqual(routeKnowledgeAgents("检查冲突并改写结论"), ["research", "writing", "review"]);
  assert.deepEqual(routeKnowledgeAgents("记住我之前的研究偏好"), ["research", "memory"]);
  assert.deepEqual(routeKnowledgeAgents("当前报告讲了什么？"), ["research"]);
}

run();
console.log("knowledge-agent-service contract passed");
