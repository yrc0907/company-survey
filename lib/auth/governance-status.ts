/** 身份治理配置只读状态；不返回凭据、客户端密钥或邮件内容。 */
export interface AuthGovernanceStatus {
  oauth: { github: "configured" | "not_configured" };
  email: { verification: "not_configured"; passwordReset: "not_configured" };
  scenario_id: "AUTH-GOVERNANCE-001";
}

/**
 * 读取部署环境中的可用能力。邮箱能力固定报告未配置，避免把“生成链接”误报为已发送邮件。
 * GitHub 只有在两个凭据同时存在时才认为已配置，半配置状态仍 fail-closed。
 */
export function getAuthGovernanceStatus(environment: Record<string, string | undefined> = process.env): AuthGovernanceStatus {
  const githubConfigured = Boolean(environment.GITHUB_CLIENT_ID?.trim() && environment.GITHUB_CLIENT_SECRET?.trim());
  return {
    oauth: { github: githubConfigured ? "configured" : "not_configured" },
    email: { verification: "not_configured", passwordReset: "not_configured" },
    scenario_id: "AUTH-GOVERNANCE-001",
  };
}
