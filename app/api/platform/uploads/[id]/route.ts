import { z } from "zod";

import { assetErrorResponse } from "@/lib/services/assets/asset-api-response";
import { AssetService } from "@/lib/services/assets/asset-service";
import { getAssetsOssProvider } from "@/lib/services/assets/oss-provider-factory";
import { getAssetsRepository } from "@/lib/repositories/assets";
import { getPlatformRepository } from "@/lib/repositories/platform/platform-repository-factory";
import { assertTrustedJsonRequest } from "@/lib/auth/request-security";
import { requireAuthenticatedActor } from "@/lib/auth/session";
import { json } from "@/lib/api/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const completeSchema = z.object({ etag: z.string().trim().min(1).max(256), size: z.number().int().min(1).max(25 * 1024 * 1024), sha256: z.string().trim().regex(/^[a-f0-9]{64}$/) }).strict();
const idSchema = z.string().trim().min(1).max(128);

function service(): Promise<AssetService> { return getAssetsOssProvider().then((oss) => new AssetService(getAssetsRepository(), getPlatformRepository(), oss)); }

/** 完成直传确认；必须携带客户端 ETag/大小/SHA-256，并与 OSS HeadObject 三重一致。 */
export async function POST(request: Request, context: { params: { id: string } }) {
  try { assertTrustedJsonRequest(request); const actor = await requireAuthenticatedActor(); const id = idSchema.parse(context.params.id); const input = completeSchema.parse(await request.json()); const result = await (await service()).completeUpload(actor, id, input); return json(result, { headers: { "cache-control": "no-store" } }); } catch (error) { return assetErrorResponse(error); }
}

/** 读取当前用户自己的上传和解析状态；跨用户 ID 统一返回 404。 */
export async function GET(_request: Request, context: { params: { id: string } }) {
  try { const actor = await requireAuthenticatedActor(); const id = idSchema.parse(context.params.id); const result = await (await service()).getStatus(actor, id); return json(result, { headers: { "cache-control": "no-store" } }); } catch (error) { return assetErrorResponse(error); }
}

/** 取消当前用户自己的上传或解析排队任务；隔离对象立即尝试清理，verified 原件永远保留。 */
export async function DELETE(_request: Request, context: { params: { id: string } }) {
  try { assertTrustedJsonRequest(_request); const actor = await requireAuthenticatedActor(); const id = idSchema.parse(context.params.id); await (await service()).cancel(actor, id); return json({ cancelled: true }, { headers: { "cache-control": "no-store" } }); } catch (error) { return assetErrorResponse(error); }
}
