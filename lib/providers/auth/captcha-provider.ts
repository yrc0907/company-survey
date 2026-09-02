export interface CaptchaVerificationInput {
  ticket: string;
  scene: string;
  clientIp: string | null;
  userId: string | null;
}

interface AliyunCaptchaTicket { lot_number: string; captcha_output: string; pass_token: string; gen_time: string; }

export interface CaptchaProvider {
  verify(input: CaptchaVerificationInput): Promise<boolean>;
}

/** 图形验证 Provider 未配置时的明确错误；生产敏感操作默认 fail closed。 */
export class CaptchaProviderNotConfiguredError extends Error {
  public constructor() {
    super("图形验证 Provider 尚未配置");
    this.name = "CaptchaProviderNotConfiguredError";
  }
}

/** 阿里云图形验证服务端适配器；不信任浏览器返回的通过标记，只校验服务端票据。 */
export class AliyunCaptchaProvider implements CaptchaProvider {
  public constructor(private readonly endpoint: string, private readonly appId: string, private readonly appKey: string, timeoutMs: number | string = 5000) { this.timeoutMs = Number.isFinite(Number(timeoutMs)) ? Number(timeoutMs) : 5000; }
  private readonly timeoutMs: number;

  public static fromEnvironment(environment: Record<string, string | undefined> = process.env): AliyunCaptchaProvider | null {
    const endpoint = (environment.ALIYUN_CAPTCHA_API_URL?.trim() || "https://captcha.alicaptcha.com/validate");
    const appId = environment.ALIYUN_CAPTCHA_APP_ID?.trim();
    const appKey = environment.ALIYUN_CAPTCHA_APP_KEY?.trim();
    if (!appId || !appKey || !isSafeEndpoint(endpoint)) return null;
    const timeoutMs = Number(environment.ALIYUN_CAPTCHA_TIMEOUT_MS ?? 5000);
    return new AliyunCaptchaProvider(endpoint, appId, appKey, Number.isFinite(timeoutMs) ? timeoutMs : 5000);
  }

  public async verify(input: CaptchaVerificationInput): Promise<boolean> {
    if (!input.ticket.trim()) return false;
    let ticket: AliyunCaptchaTicket;
    try { const parsed = JSON.parse(input.ticket) as Partial<AliyunCaptchaTicket>; if (![parsed.lot_number, parsed.captcha_output, parsed.pass_token, parsed.gen_time].every((value) => typeof value === "string" && value.trim())) return false; ticket = parsed as AliyunCaptchaTicket; } catch { return false; }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const endpoint = `${this.endpoint}?captcha_id=${encodeURIComponent(this.appId)}`;
      const form = new URLSearchParams({ lot_number: ticket.lot_number, captcha_output: ticket.captcha_output, pass_token: ticket.pass_token, gen_time: ticket.gen_time, sign_token: createHmac("sha256", this.appKey).update(ticket.lot_number).digest("hex") });
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form.toString(),
        signal: controller.signal,
      });
      if (!response.ok) return false;
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
      return payload.result === "success" || payload.success === true;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function isSafeEndpoint(value: string): boolean {
  try { const url = new URL(value); return url.protocol === "https:" && !["localhost", "127.0.0.1", "::1"].includes(url.hostname); } catch { return false; }
}

/** 未设置 CAPTCHA_PROVIDER 时返回 null；是否允许降级由服务层明确开关决定。 */
export function getCaptchaProvider(environment: Record<string, string | undefined> = process.env): CaptchaProvider | null {
  const provider = environment.CAPTCHA_PROVIDER?.trim().toLowerCase();
  if (!provider || provider === "disabled") return null;
  if (provider === "aliyun" || provider === "aliyun_captcha") return AliyunCaptchaProvider.fromEnvironment(environment);
  throw new Error(`不支持的图形验证 Provider: ${provider}`);
}
import { createHmac } from "node:crypto";
