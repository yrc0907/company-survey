import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";

import type { AssetRecord, IngestionJobRecord } from "@/lib/domain/assets";
import { createObjectKey } from "@/lib/providers/oss";
import { MemoryAssetsRepository } from "@/lib/repositories/assets";
import { AssetIngestionService } from "@/lib/services/assets/asset-ingestion-service";
import { parseAsset } from "@/lib/services/assets/asset-parser";

function digest(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }

async function seedVerified(repo: MemoryAssetsRepository, ownerUserId: string, filename: string, mimeType: string, bytes: Buffer): Promise<{ asset: AssetRecord; job: IngestionJobRecord }> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const extension = filename.slice(filename.lastIndexOf(".")).toLowerCase() as AssetRecord["extension"];
  const sha256 = digest(bytes);
  const asset: AssetRecord = {
    id, ownerUserId, projectId: null, branchId: null, originalAssetId: null, assetKind: "original", filename, extension, mimeType,
    objectKey: createObjectKey({ kind: "quarantine", ownerId: ownerUserId, uploadId: id, contentHash: sha256, extension }), expectedSize: bytes.length,
    expectedSha256: sha256, etag: "e".repeat(32), actualSize: bytes.length, actualSha256: sha256, status: "pending_upload", createdAt: now,
    uploadedAt: now, verifiedAt: now, updatedAt: now,
  };
  const job: IngestionJobRecord = { id: randomUUID(), assetId: id, idempotencyKey: `${ownerUserId}:${sha256}`, status: "queued", attempt: 0, errorCode: null, errorMessage: null, derivedAssetId: null, createdAt: now, startedAt: null, completedAt: null, updatedAt: now, leaseOwner: null, leaseExpiresAt: null };
  await repo.createIntent({ asset, ingestion: job });
  const verified = await repo.completeVerification({ assetId: id, ownerUserId, etag: asset.etag!, actualSize: bytes.length, actualSha256: sha256 });
  return { asset: verified.asset, job: verified.ingestion };
}

function minimalNativePdf(): Buffer {
  return Buffer.from("%PDF-1.4\n1 0 obj << /Type /Page >> endobj\nstream\nBT\n(Hello PDF) Tj\nET\nendstream\n%%EOF\n", "latin1");
}

/** 解析 Worker 契约：文本可完成；图片进入待校对；读取/完整性错误失败；重复执行不重复消费。 */
async function run(): Promise<void> {
  const repo = new MemoryAssetsRepository();
  const objects = new Map<string, Buffer>();
  const reader = { readObject: async (key: string, maxBytes: number) => { const bytes = objects.get(key); if (!bytes) throw new Error("对象不存在"); if (bytes.length > maxBytes) throw new Error("对象过大"); return bytes; } };
  const worker = new AssetIngestionService(repo, reader, 30);
  const owner = "asset-worker-owner";

  const textBytes = Buffer.from("# 研究报告\n\n这是可检索的正文。\n", "utf8");
  const textSeed = await seedVerified(repo, owner, "report.md", "text/markdown", textBytes);
  objects.set(textSeed.asset.objectKey, textBytes);
  const textResult = await worker.processNext("worker-a");
  assert.equal(textResult?.job.status, "ready");
  assert.equal(textResult?.outcome.kind, "text");
  assert.equal((await repo.getIngestionArtifact(textSeed.asset.id, owner))?.content, "# 研究报告\n\n这是可检索的正文。");
  assert.equal(await worker.processNext("worker-a"), null, "完成后的 Job 不应被重复领取");

  const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const image = await seedVerified(repo, owner, "scan.png", "image/png", imageBytes);
  objects.set(image.asset.objectKey, imageBytes);
  const imageResult = await worker.processNext("worker-a");
  assert.equal(imageResult?.job.status, "needs_review", "没有视觉模型时图片必须进入待校对");
  assert.equal(imageResult?.outcome.kind, "needs_review");
  assert.equal(imageResult?.outcome.code, "PARSER_REQUIRES_VISION");

  const spoofedImageBytes = Buffer.from("not-a-png", "utf8");
  const spoofedImage = await seedVerified(repo, owner, "spoofed.png", "image/png", spoofedImageBytes);
  objects.set(spoofedImage.asset.objectKey, spoofedImageBytes);
  const spoofedImageResult = await worker.processNext("worker-a");
  assert.equal(spoofedImageResult?.job.status, "failed", "图片扩展名不能绕过 magic bytes 校验");
  assert.equal(spoofedImageResult?.job.errorCode, "PARSER_FAILED");

  const broken = await seedVerified(repo, owner, "broken.txt", "text/plain", Buffer.from("expected", "utf8"));
  objects.set(broken.asset.objectKey, Buffer.from("tampered", "utf8"));
  const brokenResult = await worker.processNext("worker-a");
  assert.equal(brokenResult?.job.status, "failed", "原件完整性失败不能生成正文");
  assert.equal(brokenResult?.job.errorCode, "PARSER_FAILED");
  objects.set(broken.asset.objectKey, Buffer.from("expected", "utf8"));
  await repo.retryIngestion(broken.asset.id, owner);
  assert.equal((await worker.processNext("worker-a"))?.job.status, "ready", "修复原件读取后可显式重试解析");

  const pdfResult = parseAsset({ extension: ".pdf", mimeType: "application/pdf" }, minimalNativePdf());
  assert.equal(pdfResult.kind, "text", "带文字层的 PDF 应可提取文本");
  if (pdfResult.kind === "text") assert.match(pdfResult.text, /Hello PDF/);
  const scannedResult = parseAsset({ extension: ".pdf", mimeType: "application/pdf" }, Buffer.from("%PDF-1.4\n/Type /Page\n%%EOF\n", "latin1"));
  assert.equal(scannedResult.kind, "needs_review");
  assert.equal(scannedResult.code, "PARSER_REQUIRES_VISION");

  console.log("asset-ingestion contract: passed");
}

void run().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
