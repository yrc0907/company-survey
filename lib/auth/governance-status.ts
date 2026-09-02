/** 身份治理配置只读状态；不返回凭据、客户端密钥或邮件内容。 */
export interface AuthGovernanceStatus {
  oauth: { github: "configured" | "not_configured" };
  email: { verification: "configured" | "not_configured"; passwordReset: "configured" | "not_configured"; loginCode: "configured" | "not_configured"; change: "configured" | "not_configured" };
  sms: { loginCode: "configured" | "not_configured"; bindPhone: "configured" | "not_configured"; changePhone: "configured" | "not_configured" };
  captcha: { configured: "configured" | "not_configured" };
  scenario_id: "AUTH-GOVERNANCE-001";
}

/**
 * 读取部署环境中的可用能力；只有完整凭据组齐全才显示 configured，半配置状态仍 fail-closed。
 */
export function getAuthGovernanceStatus(environment: Record<string, string | undefined> = process.env): AuthGovernanceStatus {
  const githubConfigured = Boolean(environment.GITHUB_CLIENT_ID?.trim() && environment.GITHUB_CLIENT_SECRET?.trim());
  const emailConfigured = environment.EMAIL_PROVIDER?.trim().toLowerCase() === "aliyun_enterprise_mail"
    && Boolean(environment.SMTP_HOST?.trim() && environment.SMTP_USER?.trim() && environment.SMTP_PASSWORD?.trim());
  const smsConfigured = Boolean(environment.SMS_PROVIDER?.trim().toLowerCase() === "aliyun_dypns" && environment.ALIYUN_SMS_API_URL?.trim() && environment.ALIYUN_SMS_ACCESS_KEY_ID?.trim() && environment.ALIYUN_SMS_ACCESS_KEY_SECRET?.trim() && environment.ALIYUN_SMS_SCHEME_NAME?.trim());
  const captchaConfigured = Boolean(environment.CAPTCHA_PROVIDER?.trim().toLowerCase() === "aliyun" && environment.ALIYUN_CAPTCHA_API_URL?.trim() && environment.ALIYUN_CAPTCHA_APP_ID?.trim() && environment.ALIYUN_CAPTCHA_APP_KEY?.trim() && environment.ALIYUN_CAPTCHA_SCENE_ID?.trim());
  return {
    oauth: { github: githubConfigured ? "configured" : "not_configured" },
    email: { verification: emailConfigured ? "configured" : "not_configured", passwordReset: emailConfigured ? "configured" : "not_configured", loginCode: emailConfigured ? "configured" : "not_configured", change: emailConfigured ? "configured" : "not_configured" },
    sms: { loginCode: smsConfigured ? "configured" : "not_configured", bindPhone: smsConfigured ? "configured" : "not_configured", changePhone: smsConfigured ? "configured" : "not_configured" },
    captcha: { configured: captchaConfigured ? "configured" : "not_configured" },
    scenario_id: "AUTH-GOVERNANCE-001",
  };
}
