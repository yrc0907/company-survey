import { json } from "@/lib/api/http";
import { getAuthGovernanceStatus } from "@/lib/auth/governance-status";

// 认证能力取决于服务器运行时环境，禁止 Next 在构建期静态化并缓存凭据状态。
export const dynamic = "force-dynamic";
export const revalidate = 0;

/** 公开返回身份能力开关，供 UI 显示明确的未配置状态；绝不暴露 OAuth 凭据。 */
export function GET(): Response {
  return json(getAuthGovernanceStatus(), { headers: { "cache-control": "no-store" } });
}
