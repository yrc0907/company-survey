import type { AuthenticatedActor } from "@/lib/domain/platform";

export const ASSET_MAX_BYTES = 25 * 1024 * 1024;
export const ASSET_ALLOWED_EXTENSIONS = [".md", ".txt", ".pdf", ".docx", ".png", ".jpg", ".jpeg", ".webp"] as const;
export type AssetExtension = (typeof ASSET_ALLOWED_EXTENSIONS)[number];
export type AssetKind = "original" | "derived" | "avatar";
export type AssetStatus = "pending_upload" | "uploaded" | "verified" | "failed" | "quarantined";
export type IngestionStatus = "queued" | "uploading" | "processing" | "ready" | "failed";

export interface UploadIntentInput {
  filename: string;
  contentType: string;
  size: number;
  sha256: string;
  projectId?: string;
  branchId?: string;
  clientUploadId?: string;
}

export interface AssetRecord {
  id: string;
  ownerUserId: string;
  projectId: string | null;
  branchId: string | null;
  originalAssetId: string | null;
  assetKind: AssetKind;
  filename: string;
  extension: AssetExtension;
  mimeType: string;
  objectKey: string;
  expectedSize: number;
  expectedSha256: string;
  etag: string | null;
  actualSize: number | null;
  actualSha256: string | null;
  status: AssetStatus;
  createdAt: string;
  uploadedAt: string | null;
  verifiedAt: string | null;
  updatedAt: string;
}

export interface IngestionJobRecord {
  id: string;
  assetId: string;
  idempotencyKey: string;
  status: IngestionStatus;
  attempt: number;
  errorCode: string | null;
  errorMessage: string | null;
  derivedAssetId: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export interface UploadIntentResult {
  asset: AssetRecord;
  upload: { method: "PUT"; url: string; expiresInSeconds: number; requiredHeaders: Record<string, string>; objectKey: string };
  ingestion: IngestionJobRecord;
}

export interface CompleteUploadInput {
  etag: string;
  size: number;
  sha256: string;
}
