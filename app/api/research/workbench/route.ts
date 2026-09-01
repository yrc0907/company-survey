import { json, errorResponse } from "@/lib/api/http";
import { getResearchRepository } from "@/lib/providers/repository-factory";
import { getAiConfigurationStatus } from "@/lib/services/ai-configuration";
import { WorkbenchService } from "@/lib/services/research-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 返回工作台的只读初始化快照和不含密钥的 Provider 配置状态。 */
export async function GET() {
  try {
    const snapshot = await new WorkbenchService(getResearchRepository()).getClientSnapshot();
    return json({ snapshot, ai: getAiConfigurationStatus() });
  } catch (error) {
    return errorResponse(error);
  }
}
