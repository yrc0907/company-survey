import { z } from "zod";

import { assetErrorResponse } from "@/lib/services/assets/asset-api-response";
import { AssetService } from "@/lib/services/assets/asset-service";
import { getAssetsOssProvider } from "@/lib/services/assets/oss-provider-factory";
import { getAssetsRepository } from "@/lib/repositories/assets";
import { getPlatformRepository } from "@/lib/repositories/platform/platform-repository-factory";
import { requireAuthenticatedActor } from "@/lib/auth/session";
import { json } from "@/lib/api/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 私有 OSS 读取必须由后端确认归属后签发短期 GET URL；数据库不存签名 URL。 */
export async function GET(_request: Request, context: { params: { id: string } }) {
  try { const actor = await requireAuthenticatedActor(); const id = z.string().trim().min(1).max(128).parse(context.params.id); const oss = await getAssetsOssProvider(); const grant = await new AssetService(getAssetsRepository(), getPlatformRepository(), oss).createDownloadGrant(actor, id); return json(grant, { headers: { "cache-control": "no-store" } }); } catch (error) { return assetErrorResponse(error); }
}
