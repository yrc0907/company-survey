import { authErrorResponse } from "@/lib/auth/api-response";
import { NotFoundError, ValidationError } from "@/lib/domain/errors";
import { PublicProjectService } from "@/lib/services/platform/public-project-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function contentDisposition(filename: string): string {
  // ASCII 回退值兼容旧客户端，filename* 保留项目 slug 的 UTF-8 字符。
  const encoded = encodeURIComponent(filename).replace(/['()]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="research-project.md"; filename*=UTF-8''${encoded}`;
}

/** 公开项目 Markdown 下载；内容由 PublicProjectService 的 public + published 投影生成。 */
export async function GET(request: Request, context: { params: { id: string } }): Promise<Response> {
  try {
    const format = new URL(request.url).searchParams.get("format") ?? "markdown";
    if (format !== "markdown") throw new ValidationError("仅支持 format=markdown");
    const result = await new PublicProjectService().exportMarkdown(context.params.id);
    if (!result.data) throw new NotFoundError("公开项目不存在");
    return new Response(result.data.content, {
      status: 200,
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": contentDisposition(result.data.filename),
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
