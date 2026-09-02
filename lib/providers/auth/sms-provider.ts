import { createHmac, randomUUID } from "node:crypto";

export interface SmsMessage { phoneE164: string; code: string; codeExpireMinutes: number; idempotencyKey?: string; }
export interface SmsProvider { send(message: SmsMessage): Promise<{ providerMessageId: string | null }>; }
export class SmsProviderNotConfiguredError extends Error { public constructor() { super("短信 Provider 尚未配置"); this.name = "SmsProviderNotConfiguredError"; } }

const DEFAULT_ENDPOINT = "https://dypnsapi.aliyuncs.com/";
const DEFAULT_TIMEOUT_MS = 8_000;
function encode(value: string): string { return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`); }
function sign(parameters: Record<string, string>, secret: string): string {
  const canonical = Object.keys(parameters).sort().map((key) => `${encode(key)}=${encode(parameters[key]!)}`).join("&");
  return createHmac("sha1", `${secret}&`).update(`POST&%2F&${encode(canonical)}`).digest("base64");
}
function timeout(value: string | undefined): number { const parsed = Number(value); return Number.isInteger(parsed) && parsed >= 1_000 && parsed <= 120_000 ? parsed : DEFAULT_TIMEOUT_MS; }

/** 阿里云号码认证服务 RPC 适配器（Dypnsapi/2017-05-25）。 */
export class AliyunSmsProvider implements SmsProvider {
  public constructor(private readonly endpoint: string, private readonly accessKeyId: string, private readonly accessKeySecret: string, private readonly schemeCode: string, private readonly signName: string, private readonly templateCode: string, private readonly timeoutMs = DEFAULT_TIMEOUT_MS, private readonly fetchImplementation: typeof fetch = fetch) {}
  public static fromEnvironment(environment: Record<string, string | undefined> = process.env): AliyunSmsProvider | null {
    const accessKeyId = environment.ALIYUN_SMS_ACCESS_KEY_ID?.trim() || environment.ALIYUN_SMS_APP_ID?.trim();
    const accessKeySecret = environment.ALIYUN_SMS_ACCESS_KEY_SECRET?.trim() || environment.ALIYUN_SMS_APP_KEY?.trim();
    const schemeCode = environment.ALIYUN_SMS_SCHEME_CODE?.trim();
    if (!accessKeyId || !accessKeySecret || !schemeCode) return null;
    const endpoint = environment.ALIYUN_SMS_API_URL?.trim() || DEFAULT_ENDPOINT;
    try { if (new URL(endpoint).protocol !== "https:") return null; } catch { return null; }
    return new AliyunSmsProvider(endpoint, accessKeyId, accessKeySecret, schemeCode, environment.ALIYUN_SMS_SIGN_NAME?.trim() || "", environment.ALIYUN_SMS_TEMPLATE_CODE?.trim() || "100001", timeout(environment.ALIYUN_SMS_TIMEOUT_MS));
  }
  public async send(message: SmsMessage): Promise<{ providerMessageId: string | null }> {
    const base: Record<string, string> = { AccessKeyId: this.accessKeyId, Action: "SendSmsVerifyCode", Format: "JSON", FormatVersion: "1.0", PhoneNumber: message.phoneE164, SchemeCode: this.schemeCode, SignName: this.signName, SignatureMethod: "HMAC-SHA1", SignatureNonce: message.idempotencyKey || randomUUID(), SignatureVersion: "1.0", TemplateCode: this.templateCode, TemplateParam: JSON.stringify({ code: message.code, min: String(message.codeExpireMinutes) }), Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), Version: "2017-05-25", ...(message.idempotencyKey ? { OutId: message.idempotencyKey } : {}) };
    const body = new URLSearchParams({ ...base, Signature: sign(base, this.accessKeySecret) }).toString();
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImplementation(this.endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body, signal: controller.signal });
        const payload = await response.json().catch(() => ({})) as Record<string, unknown>; const code = payload.Code ?? payload.code;
        if (!response.ok || code !== "OK") { lastError = new Error(`短信 Provider 返回失败 (${response.status})`); if (attempt === 0 && (response.status === 429 || response.status >= 500)) { await new Promise((resolve) => setTimeout(resolve, 250)); continue; } throw lastError; }
        const messageId = payload.MessageId ?? payload.messageId ?? payload.RequestId ?? payload.requestId; return { providerMessageId: messageId ? String(messageId) : null };
      } catch (error) { lastError = error instanceof Error ? error : new Error("短信 Provider 请求失败"); if (attempt === 0) { await new Promise((resolve) => setTimeout(resolve, 250)); continue; } throw lastError; } finally { clearTimeout(timer); }
    }
    throw lastError ?? new Error("短信 Provider 请求失败");
  }
}
export function getSmsProvider(environment: Record<string, string | undefined> = process.env): SmsProvider | null {
  const provider = environment.SMS_PROVIDER?.trim().toLowerCase(); if (!provider || provider === "disabled") return null;
  if (provider === "aliyun" || provider === "aliyun_sms" || provider === "aliyun_dypns") return AliyunSmsProvider.fromEnvironment(environment);
  throw new Error(`不支持的短信 Provider: ${provider}`);
}
