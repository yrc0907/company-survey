import assert from "node:assert/strict";

import { GET as listConversationRoute, POST as createConversationRoute } from "@/app/api/ai/conversations/route";
import { setAuthenticatedActorResolverForTest } from "@/lib/auth/session";
import { ValidationError } from "@/lib/domain/errors";
import type { ConversationMessage, StructuredConversationSummary } from "@/lib/domain/memory";
import { InMemoryMemoryRepository, setMemoryRepositoryForTest } from "@/lib/repositories/memory";
import { authorizeAiScope } from "@/lib/services/context";
import {
  CompactionCircuitOpenError,
  ConversationCompactionService,
  ConversationService,
  MemoryManagementService,
  MemoryRetrievalService,
  type ConversationSummaryProvider,
} from "@/lib/services/memory";

class TinySummaryProvider implements ConversationSummaryProvider {
  public readonly name = "contract";
  public readonly model = "tiny";

  public async summarize(): Promise<StructuredConversationSummary> {
    return {
      goal: ["完成测试"], decisions: [], constraints: [], entities: [], claims: [], citationIds: [], todos: [], conflicts: [],
    };
  }
}

class FailingSummaryProvider implements ConversationSummaryProvider {
  public readonly name = "contract";
  public readonly model = "always-fail";

  public async summarize(): Promise<StructuredConversationSummary> {
    throw new Error("provider failed");
  }
}

/** 覆盖会话隔离、Scope 拒绝、压缩完整性、失败熔断、记忆时态和 API 身份边界。 */
async function run(): Promise<void> {
  const repository = new InMemoryMemoryRepository();
  const conversations = new ConversationService(repository);
  const conversation = await conversations.create({ ownerUserId: "user-a", title: "平台权限设计", projectId: "project-a", branchId: "branch-a" });
  assert.equal((await conversations.list({ ownerUserId: "user-a", query: "权限" })).length, 1, "标题全文搜索应命中当前用户会话");
  assert.equal((await conversations.list({ ownerUserId: "user-b", query: "权限" })).length, 0, "其他用户不能搜索到私人会话");
  await assert.rejects(() => conversations.get("user-b", conversation.id), /会话不存在/, "跨用户读取必须表现为不存在");

  assert.throws(() => authorizeAiScope({
    actor: { kind: "anonymous", userId: null }, scope: "project", projectId: "project-a",
    grants: { publicRead: true, projectRead: true, branchRead: false, fileRead: false, folderRead: false },
  }), ValidationError, "匿名主体不能读取私人项目 Scope");
  assert.throws(() => authorizeAiScope({
    actor: { kind: "user", userId: "user-a" }, scope: "file", projectId: "project-a",
    grants: { publicRead: false, projectRead: true, branchRead: true, fileRead: true, folderRead: false },
  }), /文件范围无法确认/, "缺少 fileId 必须 fail closed");
  assert.equal(authorizeAiScope({
    actor: { kind: "anonymous", userId: null }, scope: "public",
    grants: { publicRead: true, projectRead: false, branchRead: false, fileRead: false, folderRead: false },
  }).scope, "public", "匿名主体可在明确授权后读取全站公开范围");

  const appended: ConversationMessage[] = [];
  appended.push(await conversations.appendMessage({ ownerUserId: "user-a", conversationId: conversation.id, role: "user", content: `目标：${"建立可审计记忆。".repeat(100)}` }));
  appended.push(await conversations.appendMessage({ ownerUserId: "user-a", conversationId: conversation.id, role: "assistant", content: "已分析。".repeat(100) }));
  appended.push(await conversations.appendMessage({ ownerUserId: "user-a", conversationId: conversation.id, role: "assistant", content: "调用检索工具。".repeat(100) }));
  appended.push(await conversations.appendMessage({ ownerUserId: "user-a", conversationId: conversation.id, role: "tool", content: "工具结果。".repeat(1_000) }));
  appended.push(await conversations.appendMessage({ ownerUserId: "user-a", conversationId: conversation.id, role: "user", content: "保留最近问题" }));
  appended.push(await conversations.appendMessage({ ownerUserId: "user-a", conversationId: conversation.id, role: "assistant", content: "保留最近回答" }));
  await repository.insertTool({
    id: "tool-1", conversationId: conversation.id, callMessageId: appended[2]!.id, resultMessageId: appended[3]!.id,
    toolName: "search", argumentsHash: "hash", status: "completed", resultReference: "result-1",
    createdAt: new Date().toISOString(), completedAt: new Date().toISOString(),
  });
  const compacted = await new ConversationCompactionService(repository, new TinySummaryProvider()).compact({
    ownerUserId: "user-a", conversationId: conversation.id, protectRecentMessages: 2,
  });
  assert.equal(compacted.checkpoint.status, "completed", "闭合历史应生成完成检查点");
  assert.deepEqual(compacted.summary.sourceMessageIds, appended.slice(0, 4).map((message) => message.id), "工具调用和结果必须成对进入摘要范围");
  assert.equal((await repository.listMessages(conversation.id, "user-a")).length, 6, "压缩不能删除任何原始消息");

  // 非连续 sequence 和第二次压缩不能把 sequence 数值误当数组数量。
  const gapConversation = await conversations.create({ ownerUserId: "user-a", title: "非连续序号" });
  for (const sequence of [10, 20, 30, 40, 50, 60]) {
    await repository.appendMessage(rawMessage(gapConversation.id, sequence));
  }
  const gapCompactor = new ConversationCompactionService(repository, new TinySummaryProvider());
  const firstGap = await gapCompactor.compact({ ownerUserId: "user-a", conversationId: gapConversation.id, protectRecentMessages: 2 });
  assert.equal(firstGap.checkpoint.sourceEndSequence, 40, "第一次压缩应保护最后两条非连续序号消息");
  for (const sequence of [70, 80, 90, 100]) {
    await repository.appendMessage(rawMessage(gapConversation.id, sequence));
  }
  const secondGap = await gapCompactor.compact({ ownerUserId: "user-a", conversationId: gapConversation.id, protectRecentMessages: 2 });
  assert.equal(secondGap.checkpoint.sourceStartSequence, 50, "第二次压缩应从上次范围之后继续");
  assert.equal(secondGap.checkpoint.sourceEndSequence, 80, "第二次压缩应按 eligible 数量保护最近窗口");

  const busyConversation = await conversations.create({ ownerUserId: "user-a", title: "压缩锁" });
  for (const sequence of [1, 2, 3, 4]) await repository.appendMessage(rawMessage(busyConversation.id, sequence));
  await repository.insertCheckpoint({
    id: "checkpoint-busy", conversationId: busyConversation.id, summaryId: null, sourceStartSequence: 1, sourceEndSequence: 2,
    tokenBefore: 100, tokenAfter: null, status: "started", failureCode: null, createdAt: new Date().toISOString(), completedAt: null,
  });
  await assert.rejects(
    () => gapCompactor.compact({ ownerUserId: "user-a", conversationId: busyConversation.id, protectRecentMessages: 2 }),
    /已有压缩任务进行中/,
    "有效租期内的 started 检查点必须阻止并发压缩",
  );

  const orphanConversation = await conversations.create({ ownerUserId: "user-a", title: "遗留压缩" });
  for (const sequence of [1, 2, 3, 4]) await repository.appendMessage(rawMessage(orphanConversation.id, sequence));
  await repository.insertCheckpoint({
    id: "checkpoint-orphan", conversationId: orphanConversation.id, summaryId: null, sourceStartSequence: 1, sourceEndSequence: 2,
    tokenBefore: 100, tokenAfter: null, status: "started", failureCode: null, createdAt: "2020-01-01T00:00:00.000Z", completedAt: null,
  });
  const recovered = await gapCompactor.compact({ ownerUserId: "user-a", conversationId: orphanConversation.id, protectRecentMessages: 2 });
  assert.equal(recovered.checkpoint.status, "completed", "超时 started 应先落失败状态再允许恢复压缩");
  assert.ok((await repository.listCheckpoints(orphanConversation.id, "user-a")).some((checkpoint) => checkpoint.failureCode === "orphaned_started"), "遗留 started 的恢复原因必须可审计");

  const boundaryConversation = await conversations.create({ ownerUserId: "user-a", title: "工具边界" });
  const boundaryMessages = [
    await conversations.appendMessage({ ownerUserId: "user-a", conversationId: boundaryConversation.id, role: "user", content: "旧消息".repeat(100) }),
    await conversations.appendMessage({ ownerUserId: "user-a", conversationId: boundaryConversation.id, role: "assistant", content: "工具调用".repeat(100) }),
    await conversations.appendMessage({ ownerUserId: "user-a", conversationId: boundaryConversation.id, role: "tool", content: "稍后结果".repeat(100) }),
    await conversations.appendMessage({ ownerUserId: "user-a", conversationId: boundaryConversation.id, role: "user", content: "最近问题" }),
  ];
  await repository.insertTool({
    id: "tool-boundary", conversationId: boundaryConversation.id, callMessageId: boundaryMessages[1]!.id, resultMessageId: boundaryMessages[2]!.id,
    toolName: "search", argumentsHash: "hash", status: "completed", resultReference: "result-2",
    createdAt: new Date().toISOString(), completedAt: new Date().toISOString(),
  });
  await assert.rejects(
    () => new ConversationCompactionService(repository, new TinySummaryProvider()).compact({ ownerUserId: "user-a", conversationId: boundaryConversation.id, protectRecentMessages: 2 }),
    /没有足够的闭合历史/,
    "保护窗口切断工具对时应缩小候选，不能压缩孤立 call",
  );

  const failureConversation = await conversations.create({ ownerUserId: "user-a", title: "压缩失败" });
  for (let index = 0; index < 6; index += 1) {
    await conversations.appendMessage({ ownerUserId: "user-a", conversationId: failureConversation.id, role: index % 2 === 0 ? "user" : "assistant", content: `消息 ${index} ${"长正文".repeat(100)}` });
  }
  const failingCompactor = new ConversationCompactionService(repository, new FailingSummaryProvider());
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await assert.rejects(() => failingCompactor.compact({ ownerUserId: "user-a", conversationId: failureConversation.id, protectRecentMessages: 2 }), /provider failed/);
  }
  await assert.rejects(
    () => failingCompactor.compact({ ownerUserId: "user-a", conversationId: failureConversation.id, protectRecentMessages: 2 }),
    CompactionCircuitOpenError,
    "连续三次失败后必须熔断",
  );

  const memoryService = new MemoryManagementService(repository);
  const preference = await memoryService.create({
    ownerUserId: "user-a", scope: "user", category: "preference", content: "回答默认使用中文", state: "active",
    sources: [{ sourceType: "explicit_user", sourceId: "message-pref", extractionMode: "explicit" }],
  });
  const projectMemory = await memoryService.create({
    ownerUserId: "user-a", projectId: "project-a", scope: "project", category: "decision", content: "项目使用私有 OSS", state: "active",
    sources: [{ sourceType: "message", sourceId: "message-decision", extractionMode: "manual_review" }],
  });
  await memoryService.create({
    ownerUserId: "user-a", projectId: "project-b", scope: "project", category: "decision", content: "另一个项目使用本地文件", state: "active",
    sources: [{ sourceType: "message", sourceId: "message-other", extractionMode: "manual_review" }],
  });
  await assert.rejects(() => memoryService.create({
    ownerUserId: "user-a", scope: "user", category: "identity", content: "模型猜测的身份", state: "active",
    sources: [{ sourceType: "message", sourceId: "message-guess", extractionMode: "automatic_candidate" }],
  }), /必须先由用户确认/, "自动推断的高风险记忆不能直接启用");
  const retrieved = await new MemoryRetrievalService(repository).retrieve({
    ownerUserId: "user-a", projectId: "project-a", conversationId: conversation.id, query: "OSS 中文", maxEntries: 8, tokenBudget: 100,
  });
  assert.ok(retrieved.some((entry) => entry.item.id === preference.item.id), "用户偏好应跨项目按需召回");
  assert.ok(retrieved.some((entry) => entry.item.id === projectMemory.item.id), "当前项目记忆应被召回");
  assert.ok(retrieved.every((entry) => entry.item.projectId !== "project-b"), "其他项目记忆不能串入当前 Scope");
  const updated = await memoryService.supersede({
    ownerUserId: "user-a", memoryId: preference.item.id, content: "回答默认使用简体中文", reason: "用户修正偏好",
    sources: [{ sourceType: "explicit_user", sourceId: "message-pref-2", extractionMode: "explicit" }],
  });
  assert.equal(updated.version.version, 2, "更新记忆必须追加新版本");
  assert.equal(updated.version.supersedesVersionId, preference.version.id, "新版本必须链接被替代版本");
  await memoryService.setState("user-a", projectMemory.item.id, "disabled");
  assert.equal((await new MemoryRetrievalService(repository).retrieve({ ownerUserId: "user-a", projectId: "project-a", conversationId: null, query: "OSS" })).some((entry) => entry.item.id === projectMemory.item.id), false, "禁用记忆不得注入");

  setMemoryRepositoryForTest(repository);
  setAuthenticatedActorResolverForTest(async () => null);
  const unauthorized = await createConversationRoute(new Request("http://localhost/api/ai/conversations", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "未登录" }),
  }));
  assert.equal(unauthorized.status, 401, "未接入身份时 API 必须 fail closed");
  setAuthenticatedActorResolverForTest(async () => ({ userId: "api-user", role: "user" }));
  const createdResponse = await createConversationRoute(new Request("http://localhost/api/ai/conversations", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "API 会话" }),
  }));
  assert.equal(createdResponse.status, 201, "认证用户可通过 API 新建会话");
  const listedResponse = await listConversationRoute(new Request("http://localhost/api/ai/conversations?q=API"));
  assert.equal(listedResponse.status, 200, "认证用户可搜索自己的历史会话");
  assert.equal(((await listedResponse.json()) as { conversations: unknown[] }).conversations.length, 1, "API 搜索应返回命中会话");
  setAuthenticatedActorResolverForTest(null);
  setMemoryRepositoryForTest(null);

  console.log("memory-service contract: passed");
}

void run().catch((error: unknown) => {
  setAuthenticatedActorResolverForTest(null);
  setMemoryRepositoryForTest(null);
  console.error(error);
  process.exitCode = 1;
});

function rawMessage(conversationId: string, sequence: number): ConversationMessage {
  return {
    id: `${conversationId}-message-${sequence}`,
    conversationId,
    sequence,
    role: sequence % 20 === 0 ? "assistant" : "user",
    content: `序号 ${sequence} ${"可压缩正文".repeat(100)}`,
    tokenEstimate: 300,
    parentMessageId: null,
    metadata: {},
    createdAt: new Date().toISOString(),
  };
}
