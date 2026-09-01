import { ValidationError } from "@/lib/domain/errors";

/**
 * 校验用户显式导入的网页地址。
 * 禁止本机、内网和非 HTTP(S) 协议，避免未来接入抓取器时被 SSRF 利用。
 */
export function assertSafeSourceUrl(rawUrl: string): URL {
  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    throw new ValidationError("来源 URL 无效");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ValidationError("仅允许导入 HTTP 或 HTTPS 来源");
  }

  if (url.username || url.password) {
    throw new ValidationError("来源 URL 不允许包含账号信息");
  }

  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "0.0.0.0" ||
    host === "::1" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  ) {
    throw new ValidationError("不允许导入本机或内网来源");
  }

  return url;
}
