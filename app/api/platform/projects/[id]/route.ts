import { authErrorResponse } from "@/lib/auth/api-response";
import { json } from "@/lib/api/http";
import { NotFoundError } from "@/lib/domain/errors";
import { PublicProjectService } from "@/lib/services/platform/public-project-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 项目详情只读取已发布的公开主版本，私有项目统一返回 404 以避免枚举。 */
export async function GET(_request: Request, context: { params: { id: string } }) {
  try {
    const result = await new PublicProjectService().get(context.params.id);
    if (!result.data) throw new NotFoundError("公开项目不存在");
    return json({ project: result.data, source: result.source });
  } catch (error) {
    return authErrorResponse(error);
  }
}

