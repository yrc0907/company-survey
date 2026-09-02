import assert from "node:assert/strict";
import type { GuestDraft, GuestDraftStore } from "./guest-draft-store";
import { migrateGuestDraft } from "./guest-draft-store";

class MemoryStore implements GuestDraftStore {
  private readonly drafts = new Map<string, GuestDraft>();
  async get(id: string) { return this.drafts.get(id) ?? null; }
  async put(draft: GuestDraft) { this.drafts.set(draft.id, structuredClone(draft)); }
  async delete(id: string) { this.drafts.delete(id); }
}

const store = new MemoryStore();
const draft: GuestDraft = { id: "guest-report-1", reportId: "report-1", baseRevision: 4, title: "本地草稿", sections: [], updatedAt: new Date().toISOString() };
async function run(): Promise<void> {
  await store.put(draft);
  let calls = 0;
  const migrated = await migrateGuestDraft(store, draft.id, "user-1", async (value) => { calls += 1; assert.equal(value.baseRevision, 4); });
  assert.equal(migrated?.migratedTo, "user-1");
  await migrateGuestDraft(store, draft.id, "user-1", async () => { calls += 1; });
  assert.equal(calls, 1, "登录迁移必须幂等，重复回调不能重复提交");
  console.log("guest draft store contract passed");
}
void run();
