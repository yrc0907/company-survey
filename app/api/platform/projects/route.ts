import { z } from "zod";

import { authErrorResponse } from "@/lib/auth/api-response";
import { requireAuthenticatedActor } from "@/lib/auth/session";
import { assertTrustedJsonRequest } from "@/lib/auth/request-security";
import { json } from "@/lib/api/http";
import { collaborationErrorResponse } from "@/lib/services/collaboration";
import { CollaborationService } from "@/lib/services/collaboration";
import { getCollaborationRepository } from "@/lib/repositories/collaboration";
import { getPlatformRepository } from "@/lib/repositories/platform/platform-repository-factory";
import { PublicProjectService } from "@/lib/services/platform/public-project-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const projectSchema = z.object({ title: z.string().trim().min(2).max(160), slug: z.string().trim().min(2).max(80).regex(/^[a-z0-9][a-z0-9-]*$/, "项目地址只能使用小写字母、数字和短横线").optional(), summary: z.string().trim().max(2000).optional(), visibility: z.enum(["private", "public", "unlisted"]).optional(), license: z.string().trim().min(1).max(120).optional() }).strict();

/** 未填写 slug 时从标题生成稳定地址；服务端再次验证，客户端不能注入身份或路径。 */
function slugFromTitle(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
  if (!slug) throw new Error("项目标题无法生成有效地址，请手动填写 slug");
  return slug;
}

function service(): CollaborationService { return new CollaborationService(getCollaborationRepository(), getPlatformRepository()); }

/** 公开项目列表无需登录；搜索只在公开索引范围内执行。 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    // 本地无数据库时只读 typed seed，保证公开首页可预览且明确标识来源。
    const result = await new PublicProjectService().list({
      query: url.searchParams.get("q") ?? undefined,
      category: (url.searchParams.get("category") as "企业" | "政策" | "行业" | "技术" | null) ?? undefined,
      sort: (url.searchParams.get("sort") as "recommended" | "latest" | "read" | null) ?? "recommended",
      limit: Number(url.searchParams.get("limit") ?? 100),
    });
    // 列表和详情统一走 PublicProjectRecord 投影，避免旧协作摘要丢失分类、标签和真实统计。
    return json({ projects: result.data, source: result.source });
  }
  catch (error) { return collaborationErrorResponse(error) ?? authErrorResponse(error); }
}

/** 创建项目必须登录；owner 从签名 Session 提取，忽略 Body 中任何身份字段。 */
export async function POST(request: Request) {
  try { assertTrustedJsonRequest(request); const actor = await requireAuthenticatedActor(); const input = projectSchema.parse(await request.json()); return json({ project: await service().createProject({ ...input, slug: input.slug ?? slugFromTitle(input.title) }, actor) }, { status: 201 }); }
  catch (error) { return collaborationErrorResponse(error) ?? authErrorResponse(error); }
}
