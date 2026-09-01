import { z } from "zod";

import { assertTrustedJsonRequest } from "@/lib/auth/request-security";
import { requireAuthenticatedActor } from "@/lib/auth/session";
import { json } from "@/lib/api/http";
import { getAssetsRepository } from "@/lib/repositories/assets";
import { getPlatformRepository } from "@/lib/repositories/platform/platform-repository-factory";
import { getResearchRepository } from "@/lib/providers/repository-factory";
import { assetErrorResponse } from "@/lib/services/assets/asset-api-response";
import { ArtifactSourceIndexService } from "@/lib/services/assets/artifact-source-index-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idSchema = z.string().trim().min(1).max(128);
const inputSchema = z.object({
  reportId: z.string().trim().min(1).max(128),
  projectId: z.string().trim().min(1).max(128),
  branchId: z.string().trim().min(1).max(128),
  sourceTitle: z.string().trim().min(1).max(255).optional(),
}).strict();

/**
 * 将已完成的文本解析产物显式登记为检索来源。
 * 索引不是上传完成的隐式副作用：调用方必须声明报告、项目和分支，服务层再次校验
 * owner/成员/分支/哈希，避免把一个用户的文件或过期产物泄漏到其他报告。
 */
export async function POST(request: Request, context: { params: { id: string } }) {
  try {
    assertTrustedJsonRequest(request);
    const actor = await requireAuthenticatedActor();
    const assetId = idSchema.parse(context.params.id);
    const input = inputSchema.parse(await request.json());
    const service = new ArtifactSourceIndexService(
      getAssetsRepository(),
      getPlatformRepository(),
      getResearchRepository(),
    );
    const result = await service.indexReadyArtifact(actor, { ...input, assetId });
    return json(result, {
      status: result.status === "indexed" ? 201 : 200,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return assetErrorResponse(error);
  }
}
