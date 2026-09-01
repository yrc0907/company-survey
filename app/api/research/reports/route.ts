import { z } from "zod";

import { errorResponse, json } from "@/lib/api/http";
import { getResearchRepository } from "@/lib/providers/repository-factory";
import { ReportService } from "@/lib/services/research-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 新建报告请求只接受用户显式填写的元数据，AI 不能通过该路由直接写正文。 */
const createReportSchema = z.object({
  companyId: z.string().min(1),
  title: z.string().min(1).max(160),
  firstSection: z.object({
    heading: z.string().min(1).max(160).optional(),
    content: z.string().max(40_000).optional(),
    evidenceState: z.enum(["fact", "inference", "needs_verification", "conflict"]).optional(),
  }).optional(),
});

/** 创建用户发起的报告并建立 v1 revision。 */
export async function POST(request: Request) {
  try {
    const input = createReportSchema.parse(await request.json());
    const result = await new ReportService(getResearchRepository()).createReport(input);
    return json(result, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
