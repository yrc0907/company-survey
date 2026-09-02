export interface SmsMessage {
  phoneE164: string;
  code: string;
  codeExpireMinutes: number;
}

export interface SmsProvider {
  send(message: SmsMessage): Promise<{ providerMessageId: string | null }>;
}

/** 短信 Provider 未配置时的明确错误；验证码挑战不会被标记为已发送。 */
export class SmsProviderNotConfiguredError extends Error {
  public constructor() {
    super("短信 Provider 尚未配置");
    this.name = "SmsProviderNotConfiguredError";
  }
}

/**
 * 阿里云短信认证 HTTP 适配器。
 * 不绑定某个 SDK 版本，按控制台方案提供 JSON 端点；appId/appKey 仅从环境读取。
 * 端点、请求头和返回字段可通过环境覆盖，便于在号码认证服务与短信推送 API 间替换。
 */
export class AliyunSmsProvider implements SmsProvider {
  public constructor(
    private readonly endpoint: string,
    private readonly appId: string,
    private readonly appKey: string,
    private readonly schemeCode: string,
    private readonly signName: string,
    private readonly templateCode: string,
    private readonly timeoutMs = 8000,
  ) {}

  public static fromEnvironment(environment: Record<string, string | undefined> = process.env): AliyunSmsProvider | null {
    const endpoint = environment.ALIYUN_SMS_API_URL?.trim();
    const appId = environment.ALIYUN_SMS_APP_ID?.trim();
    const appKey = environment.ALIYUN_SMS_APP_KEY?.trim();
    if (!endpoint || !appId || !appKey) return null;
    const schemeCode = environment.ALIYUN_SMS_SCHEME_CODE?.trim() || "";
    const signName = environment.ALIYUN_SMS_SIGN_NAME?.trim() || "";
    const templateCode = environment.ALIYUN_SMS_TEMPLATE_CODE?.trim() || "100001";
    const timeoutMs = Number(environment.ALIYUN_SMS_TIMEOUT_MS ?? 8000);
    return new AliyunSmsProvider(endpoint, appId, appKey, schemeCode, signName, templateCode, Number.isFinite(timeoutMs) ? timeoutMs : 8000);
  }

  public async send(message: SmsMessage): Promise<{ providerMessageId: string | null }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-app-id": this.appId,
          "x-app-key": this.appKey,
          authorization: `Basic ${Buffer.from(`${this.appId}:${this.appKey}`).toString("base64")}`,
        },
        body: JSON.stringify({
          phoneNumber: message.phoneE164,
          code: message.code,
          codeExpire: message.codeExpireMinutes,
          schemeCode: this.schemeCode || undefined,
          signName: this.signName || undefined,
          templateCode: this.templateCode,
        }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok || payload.success === false || payload.code && String(payload.code) !== "OK" && String(payload.code) !== "200") {
        throw new Error(`短信 Provider 返回失败 (${response.status})`);
      }
      const dataMessageId = payload.data && typeof payload.data === "object" ? (payload.data as Record<string, unknown>).messageId : null;
      const providerMessageId = payload.messageId ?? payload.requestId ?? dataMessageId;
      return { providerMessageId: providerMessageId ? String(providerMessageId) : null };
    } finally {
      clearTimeout(timeout);
    }
  }
}

/** 读取短信 Provider；未配置时返回 null，避免把未发送伪装为成功。 */
export function getSmsProvider(environment: Record<string, string | undefined> = process.env): SmsProvider | null {
  const provider = environment.SMS_PROVIDER?.trim().toLowerCase();
  if (!provider || provider === "disabled") return null;
  if (provider === "aliyun" || provider === "aliyun_sms" || provider === "aliyun_dypns") return AliyunSmsProvider.fromEnvironment(environment);
  throw new Error(`不支持的短信 Provider: ${provider}`);
}
