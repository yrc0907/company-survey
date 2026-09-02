import type { ReportSection } from "@/lib/domain/research";

/** 游客本地草稿的可迁移快照；内容只存浏览器，不包含来源原文或凭据。 */
export interface GuestDraft {
  id: string;
  reportId: string;
  baseRevision: number;
  title: string;
  sections: ReportSection[];
  updatedAt: string;
  migratedTo?: string;
}

export interface GuestDraftStore {
  get(id: string): Promise<GuestDraft | null>;
  put(draft: GuestDraft): Promise<void>;
  delete(id: string): Promise<void>;
}

const DB_NAME = "research-workbench";
const STORE_NAME = "guest-drafts";

/** IndexedDB 适配器。SSR、隐私模式或 IndexedDB 不可用时由调用方降级为不持久化。 */
export function createIndexedDbGuestDraftStore(): GuestDraftStore {
  async function open(): Promise<IDBDatabase> {
    if (typeof indexedDB === "undefined") throw new Error("当前环境不支持 IndexedDB");
    return await new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("打开本地草稿失败"));
    });
  }
  return {
    async get(id) { const db = await open(); return await new Promise((resolve, reject) => { const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(id); request.onsuccess = () => resolve((request.result as GuestDraft | undefined) ?? null); request.onerror = () => reject(request.error); }); },
    async put(draft) { const db = await open(); await new Promise<void>((resolve, reject) => { const request = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(structuredClone(draft)); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); }); },
    async delete(id) { const db = await open(); await new Promise<void>((resolve, reject) => { const request = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).delete(id); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); }); },
  };
}

/** 登录迁移必须先成功提交到目标账户，再标记已迁移，重复回调不会重复写入。 */
export async function migrateGuestDraft(store: GuestDraftStore, draftId: string, targetUserId: string, migrate: (draft: GuestDraft) => Promise<void>): Promise<GuestDraft | null> {
  const draft = await store.get(draftId);
  if (!draft || draft.migratedTo) return draft;
  await migrate(structuredClone(draft));
  const migrated = { ...draft, migratedTo: targetUserId, updatedAt: new Date().toISOString() };
  await store.put(migrated);
  return migrated;
}
