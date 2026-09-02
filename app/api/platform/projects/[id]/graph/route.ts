import { authErrorResponse } from "@/lib/auth/api-response";
import { json } from "@/lib/api/http";
import { PublicProjectGraphService } from "@/lib/services/platform/public-project-graph-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 公开项目关系图只读接口。
 * 服务层先验证 public/published，再按项目稳定 report 映射读取实体和关系；匿名请求不会得到草稿或跨项目数据。
 */
export async function GET(_request: Request, context: { params: { id: string } }) {
  try {
    const result = await new PublicProjectGraphService().get(context.params.id);
    return json(result);
  } catch (error) {
    return authErrorResponse(error);
  }
}

