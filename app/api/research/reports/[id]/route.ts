import { z } from "zod";

import { errorResponse, json } from "@/lib/api/http";
import { getResearchRepository } from "@/lib/providers/repository-factory";
import { ReportService } from "@/lib/services/research-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 保存报告时必须携带客户端已读取的版本号，禁止无条件覆盖。 */
const saveReportSchema = z.object({
  title: z.string().min(1).max(160),
  expectedVersion: z.number().int().min(1),
  sections: z.array(z.object({
    id: z.string().optional().default(""),
    parentSectionId: z.string().nullable(),
    heading: z.string().min(1).max(160),
    anchor: z.string().max(200).optional().default(""),
    level: z.number().int().min(1).max(6),
    position: z.number().int().min(1),
    content: z.string().max(40_000),
    evidenceState: z.enum(["fact", "inference", "needs_verification", "conflict"]),
  })).min(1).max(80),
});

/** 用户确认修改后保存一份新 revision；版本冲突返回 409。 */
export async function PUT(request: Request, context: { params: { id: string } }) {
  try {
    const input = saveReportSchema.parse(await request.json());
    const result = await new ReportService(getResearchRepository()).saveReport(context.params.id, input);
    return json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
