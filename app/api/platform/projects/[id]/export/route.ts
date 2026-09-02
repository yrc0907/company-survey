import { authErrorResponse } from "@/lib/auth/api-response";
import { NotFoundError, ValidationError } from "@/lib/domain/errors";
import { PublicProjectService } from "@/lib/services/platform/public-project-service";
import { formatPublicProjectPdf } from "@/lib/services/platform/public-project-pdf";
import { formatPublicProjectMarkdown } from "@/lib/services/platform/public-project-markdown";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function contentDisposition(filename: string): string {
  // ASCII 回退值兼容旧客户端，filename* 保留项目 slug 的 UTF-8 字符。
  const encoded = encodeURIComponent(filename).replace(/['()]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="research-project${filename.toLowerCase().endsWith(".pdf") ? ".pdf" : ".md"}"; filename*=UTF-8''${encoded}`;
}

/** 公开项目 Markdown 下载；内容由 PublicProjectService 的 public + published 投影生成。 */
export async function GET(request: Request, context: { params: { id: string } }): Promise<Response> {
  try {
    const format = new URL(request.url).searchParams.get("format") ?? "markdown";
    if (format !== "markdown" && format !== "pdf") throw new ValidationError("仅支持 format=markdown 或 format=pdf");
    const project = (await new PublicProjectService().get(context.params.id)).data;
    if (!project) throw new NotFoundError("公开项目不存在");
    if (format === "pdf") {
      const pdf = formatPublicProjectPdf(project);
      return new Response(Buffer.from(pdf.content), {
        status: 200,
        headers: {
          "content-type": "application/pdf",
          "content-disposition": contentDisposition(pdf.filename),
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      });
    }
    const markdown = formatPublicProjectMarkdown(project);
    return new Response(markdown.content, {
      status: 200,
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": contentDisposition(markdown.filename),
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
