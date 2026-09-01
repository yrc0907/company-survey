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

/** 解析失败只允许同一上传者显式重试，SQL 状态条件保证重复点击不会增加 attempt。 */
export async function POST(request: Request, context: { params: { id: string } }) {
  try { assertTrustedJsonRequest(request); const actor = await requireAuthenticatedActor(); const id = z.string().trim().min(1).max(128).parse(context.params.id); const oss = await getAssetsOssProvider(); const job = await new AssetService(getAssetsRepository(), getPlatformRepository(), oss).retry(actor, id); return json({ ingestion: job }, { headers: { "cache-control": "no-store" } }); } catch (error) { return assetErrorResponse(error); }
}
