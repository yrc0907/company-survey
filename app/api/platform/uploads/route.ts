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

const inputSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(200),
  size: z.number().int().min(1).max(25 * 1024 * 1024),
  sha256: z.string().trim().regex(/^[a-f0-9]{64}$/),
  projectId: z.string().trim().min(1).max(128).optional(),
  branchId: z.string().trim().min(1).max(128).optional(),
  clientUploadId: z.string().trim().min(1).max(128).optional(),
}).strict().superRefine((input, context) => {
  if (input.branchId && !input.projectId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["projectId"], message: "指定分支时必须指定项目" });
  if (input.projectId && !input.branchId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["branchId"], message: "项目上传必须指定目标草稿分支" });
});

/** 仅登录用户可以创建 OSS 直传意图；请求体中的 owner/userId 一律不接受。 */
export async function POST(request: Request) {
  try {
    assertTrustedJsonRequest(request);
    const actor = await requireAuthenticatedActor();
    const input = inputSchema.parse(await request.json());
    const service = new AssetService(getAssetsRepository(), getPlatformRepository(), await getAssetsOssProvider());
    const result = await service.createUploadIntent(actor, input);
    return json(result, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) { return assetErrorResponse(error); }
}
