import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";

import type { AssetRecord, IngestionJobRecord } from "@/lib/domain/assets";
import type { Source, SourceChunk, WorkbenchSnapshot } from "@/lib/domain/research";
import { MemoryAssetsRepository } from "@/lib/repositories/assets";
import { MemoryPlatformRepository } from "@/lib/repositories/platform/memory-platform-repository";
import type { ResearchRepository } from "@/lib/providers/research-repository";
import { createObjectKey } from "@/lib/providers/oss";
import { AssetIngestionService } from "@/lib/services/assets/asset-ingestion-service";
import { ArtifactSourceIndexService } from "@/lib/services/assets/artifact-source-index-service";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function emptySnapshot(): WorkbenchSnapshot {
  return { companies: [], reports: [{ id: "report-index", companyId: "company-index", title: "索引测试报告", status: "draft", currentVersion: 1, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" }], sections: [], sources: [], chunks: [], citations: [], entities: [], edges: [], revisions: [] };
}

function fakeResearch(snapshot: WorkbenchSnapshot): ResearchRepository {
  return {
    getSnapshot: async () => structuredClone(snapshot),
    getReport: async (reportId: string) => snapshot.reports.find((report) => report.id === reportId) ?? null,
    createTextSource: async (source: Source, chunks: SourceChunk[]) => {
      const existing = snapshot.sources.find((item) => item.reportId === source.reportId && item.contentHash === source.contentHash);
      if (existing) return;
      snapshot.sources.push(structuredClone(source));
      snapshot.chunks.push(...structuredClone(chunks).map((chunk: SourceChunk) => ({ ...chunk, sourceId: source.id })));
    },
    health: async () => ({ ok: true, persistence: "memory_demo" }),
  } as unknown as ResearchRepository;
}

async function seedAsset(repo: MemoryAssetsRepository, ownerUserId: string, projectId: string, branchId: string, content: string): Promise<{ asset: AssetRecord; job: IngestionJobRecord; objects: Map<string, Buffer> }> {
  const bytes = Buffer.from(content, "utf8");
  const contentHash = sha256(content);
  const id = randomUUID();
  const now = new Date().toISOString();
  const asset: AssetRecord = {
    id, ownerUserId, projectId, branchId, originalAssetId: null, assetKind: "original", filename: "调查资料.md", extension: ".md", mimeType: "text/markdown",
    objectKey: createObjectKey({ kind: "quarantine", ownerId: ownerUserId, uploadId: id, contentHash, extension: ".md" }), expectedSize: bytes.length, expectedSha256: contentHash,
    etag: "e".repeat(32), actualSize: bytes.length, actualSha256: contentHash, status: "pending_upload", createdAt: now, uploadedAt: now, verifiedAt: now, updatedAt: now,
  };
  const job: IngestionJobRecord = { id: randomUUID(), assetId: id, idempotencyKey: `${ownerUserId}:${contentHash}`, status: "queued", attempt: 0, errorCode: null, errorMessage: null, derivedAssetId: null, createdAt: now, startedAt: null, completedAt: null, updatedAt: now, leaseOwner: null, leaseExpiresAt: null };
  await repo.createIntent({ asset, ingestion: job });
  await repo.completeVerification({ assetId: id, ownerUserId, etag: asset.etag!, actualSize: bytes.length, actualSha256: contentHash });
  return { asset, job, objects: new Map([[asset.objectKey, bytes]]) };
}

/** 解析产物入索引契约：ready/哈希/项目分支授权、重复消费和越权均必须有稳定边界。 */
async function run(): Promise<void> {
  const assets = new MemoryAssetsRepository();
  const platform = new MemoryPlatformRepository();
  const snapshot = emptySnapshot();
  platform.seedProject({ id: "index-project", ownerUserId: "index-owner", visibility: "public", status: "published", memberRole: null });
  platform.seedBranch({ id: "index-branch", projectId: "index-project", ownerUserId: "index-owner", isProtected: false, status: "active" });
  const research = fakeResearch(snapshot);
  const first = await seedAsset(assets, "index-owner", "index-project", "index-branch", "# 研究资料\n\n跨境电商市场与竞争分析。\n\n价格仍待核验。\n");
  const worker = new AssetIngestionService(assets, { readObject: async (key) => first.objects.get(key)! });
  assert.equal((await worker.processNext("index-worker"))?.job.status, "ready");

  const service = new ArtifactSourceIndexService(assets, platform, research);
  const actor = { userId: "index-owner", role: "user" as const };
  const input = { assetId: first.asset.id, reportId: "report-index", projectId: "index-project", branchId: "index-branch" };
  const indexed = await service.indexReadyArtifact(actor, input);
  assert.equal(indexed.status, "indexed");
  assert.equal(indexed.source.ingestionArtifactId !== null, true);
  assert.ok(indexed.chunks.length >= 2, "正文应按自然段形成多个 Chunk");
  assert.equal(indexed.source.contentHash, sha256(indexed.source.snapshot));
  assert.ok(indexed.chunks.every((chunk) => chunk.sourceId === indexed.source.id && chunk.contentHash.length === 64));

  const repeated = await service.indexReadyArtifact(actor, input);
  assert.equal(repeated.status, "idempotent", "同一产物重复消费不能创建第二个 source");
  assert.equal(snapshot.sources.length, 1);
  assert.equal(snapshot.chunks.length, indexed.chunks.length);

  await assert.rejects(() => service.indexReadyArtifact({ userId: "someone-else", role: "user" }, input), /权限|项目分支/);
  await assert.rejects(() => service.indexReadyArtifact(actor, { ...input, projectId: "other-project" }), /权限|项目分支/);

  const pending = await seedAsset(assets, "index-owner", "index-project", "index-branch", "还未解析");
  await assert.rejects(() => service.indexReadyArtifact(actor, { ...input, assetId: pending.asset.id }), /ready|解析产物/);
  console.log("artifact-source-index contract: passed");
}

void run().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
