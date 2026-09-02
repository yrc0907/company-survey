import { json } from "@/lib/api/http";
import { getAuthGovernanceStatus } from "@/lib/auth/governance-status";

/** 公开返回身份能力开关，供 UI 显示明确的未配置状态；绝不暴露 OAuth 凭据。 */
export function GET(): Response {
  return json(getAuthGovernanceStatus(), { headers: { "cache-control": "no-store" } });
}
