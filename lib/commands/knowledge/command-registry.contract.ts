import assert from "node:assert/strict";

import { KnowledgeCommandRegistry } from "@/lib/commands/knowledge/command-registry";
import { MemoryKnowledgeCommandStore } from "@/lib/commands/knowledge/memory-command-store";
import type { KnowledgeBranchContext, KnowledgeNodeRecord } from "@/lib/commands/knowledge/types";

async function run(): Promise<void> {
  const draft: KnowledgeBranchContext = { id: "branch-draft", projectId: "project-1", ownerId: "user-1", storage: "server_draft", status: "active" };
  const published: KnowledgeBranchContext = { id: "branch-main", projectId: "project-1", ownerId: null, storage: "published", status: "active" };
  const folder: KnowledgeNodeRecord = { id: "folder-1", projectId: "project-1", parentId: null, kind: "folder", name: "报告", deletedAt: null };
  const child: KnowledgeNodeRecord = { id: "doc-1", projectId: "project-1", parentId: folder.id, kind: "document", name: "概览", deletedAt: null };
  const stores = new Map<string, Map<string, KnowledgeNodeRecord>>([
    [draft.id, new Map([[folder.id, folder], [child.id, child]])],
    [published.id, new Map([[folder.id, folder], [child.id, child]])],
  ]);
  let idCounter = 0;
  const store = new MemoryKnowledgeCommandStore(new Map([[draft.id, draft], [published.id, published]]), stores);
  const registry = new KnowledgeCommandRegistry(store, undefined, () => "2026-09-01T12:00:00.000Z", () => `generated-${++idCounter}`);

  const created = await registry.execute(draft.id, { userId: "user-1" }, { type: "create_node", parentId: folder.id, kind: "document", name: "竞争分析" });
  assert.equal(created.node?.parentId, folder.id);
  assert.equal(created.change.command.type, "create_node");
  await assert.rejects(() => registry.execute(published.id, { userId: "user-1" }, { type: "rename_node", nodeId: child.id, name: "修改公开版" }), /禁止直接修改/);
  await assert.rejects(() => registry.execute(draft.id, { userId: "other" }, { type: "delete_node", nodeId: child.id }), /无权/);
  await assert.rejects(() => registry.execute(draft.id, { userId: "user-1" }, { type: "create_node", parentId: folder.id, kind: "document", name: "概览" }), /同名/);
  await assert.rejects(() => registry.execute(draft.id, { userId: "user-1" }, { type: "move_node", nodeId: folder.id, parentId: child.id }), /只能在文件夹/);

  const deleted = await registry.execute(draft.id, { userId: "user-1" }, { type: "delete_node", nodeId: child.id });
  assert.ok(deleted.node?.deletedAt);
  const restored = await registry.execute(draft.id, { userId: "user-1" }, { type: "restore_node", nodeId: child.id });
  assert.equal(restored.node?.deletedAt, null);
  assert.equal(store.changes.length, 3, "只有成功命令可以写入变更日志");

  console.log("knowledge-command registry contract: passed");
}

void run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
