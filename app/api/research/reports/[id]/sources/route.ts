import { z } from "zod";

import { errorResponse, json } from "@/lib/api/http";
import type { Source } from "@/lib/domain/research";
import { getResearchRepository } from "@/lib/providers/repository-factory";
import { MAX_MANUAL_SOURCE_TEXT_LENGTH, MAX_MANUAL_SOURCE_TITLE_LENGTH, ManualTextSourceService } from "@/lib/services/manual-text-source-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 只接收用户明确粘贴的文本资料；URL、文件路径、附件和抓取选项均不在该入口的允许范围。
 * 正文上限与领域服务保持一致，避免 API 层和业务层对输入边界产生分歧。
 */
const manualTextSourceSchema = z.object({
  title: z.string().min(1).max(MAX_MANUAL_SOURCE_TITLE_LENGTH),
  text: z.string().min(1).max(MAX_MANUAL_SOURCE_TEXT_LENGTH),
});

/** 返回来源预览，避免在创建后把完整正文经 API 回传给浏览器。 */
function toClientSource(source: Source): Source {
  return {
    ...source,
    snapshot: source.snapshot.length > 320 ? `${source.snapshot.slice(0, 320)}…` : source.snapshot,
  };
}

/** 创建人工文本来源及其服务端 Chunk；memory_demo 会返回明确的持久化拒绝。 */
export async function POST(request: Request, context: { params: { id: string } }) {
  try {
    const input = manualTextSourceSchema.parse(await request.json());
    const { source } = await new ManualTextSourceService(getResearchRepository()).import(context.params.id, input);
    return json({ source: toClientSource(source) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
