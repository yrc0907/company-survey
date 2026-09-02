export interface CaptchaVerificationInput {
  ticket: string;
  scene: string;
  clientIp: string | null;
  userId: string | null;
}

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
  public constructor(private readonly endpoint: string, private readonly appId: string, private readonly appKey: string, private readonly sceneId: string, private readonly timeoutMs = 5000) {}

  public static fromEnvironment(environment: Record<string, string | undefined> = process.env): AliyunCaptchaProvider | null {
    const endpoint = (environment.ALIYUN_CAPTCHA_API_URL?.trim() || "https://captcha.aliyuncs.com/VerifyIntelligentCaptcha");
    const appId = environment.ALIYUN_CAPTCHA_APP_ID?.trim();
    const appKey = environment.ALIYUN_CAPTCHA_APP_KEY?.trim();
    const sceneId = environment.ALIYUN_CAPTCHA_SCENE_ID?.trim();
    if (!appId || !appKey || !sceneId || !isSafeEndpoint(endpoint)) return null;
    const timeoutMs = Number(environment.ALIYUN_CAPTCHA_TIMEOUT_MS ?? 5000);
    return new AliyunCaptchaProvider(endpoint, appId, appKey, sceneId, Number.isFinite(timeoutMs) ? timeoutMs : 5000);
  }

  public async verify(input: CaptchaVerificationInput): Promise<boolean> {
    if (!input.ticket.trim() || !input.scene.trim()) return false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ CaptchaVerifyParam: input.ticket, SceneId: this.sceneId, AppId: this.appId, AppKey: this.appKey, RemoteIp: input.clientIp ?? undefined }),
        signal: controller.signal,
      });
      if (!response.ok) return false;
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
      return payload.success === true || payload.verifyResult === true || payload.captchaResult === true;
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
