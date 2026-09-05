import assert from "node:assert/strict";

import { MemoryResearchRepository } from "@/lib/providers/research-repository";
import { createDemoSnapshot } from "@/lib/providers/seed";
import { KnowledgeAgentService, listKnowledgeAgents, routeKnowledgeAgents } from "@/lib/services/agents/knowledge-agent-service";

/** 验证动态路由覆盖平台级知识任务，而非只覆盖调研。 */
async function run(): Promise<void> {
  assert.deepEqual(listKnowledgeAgents().map((agent) => agent.name), ["research", "document", "evidence", "writing", "review", "conflict", "publishing", "memory"]);
  assert.deepEqual(routeKnowledgeAgents("查找当前报告的关键证据"), ["research", "review"]);
  assert.deepEqual(routeKnowledgeAgents("把当前章节改写成一段摘要"), ["research", "writing"]);
  assert.deepEqual(routeKnowledgeAgents("检查冲突并改写结论"), ["research", "writing", "review", "conflict"]);
  assert.deepEqual(routeKnowledgeAgents("提取事实 Claim 并准备发布说明"), ["research", "evidence", "publishing"]);
  assert.deepEqual(routeKnowledgeAgents("解析上传的 PDF 并建立索引"), ["research", "document"]);
  assert.deepEqual(routeKnowledgeAgents("记住我之前的研究偏好"), ["research", "memory"]);
  assert.deepEqual(routeKnowledgeAgents("当前报告讲了什么？"), ["research"]);
  const service = new KnowledgeAgentService(new MemoryResearchRepository(createDemoSnapshot), { complete: async () => ({ status: "completed" as const, reason: "contract", answer: "ok" }) });
  await assert.rejects(() => service.run({ reportId: "report-huice", projectId: "project-huice", scope: "current_project", question: "检查证据" }, { actorUserId: "user-a", projectId: "project-other", scope: "current_project" }), /Scope/);
}

run().then(() => console.log("knowledge-agent-service contract passed"));
