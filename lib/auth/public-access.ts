/**
 * 公开认证入口开关。
 *
 * 服务端优先读取 PUBLIC_AUTH_ENABLED；浏览器端使用 Next 注入的
 * NEXT_PUBLIC_PUBLIC_AUTH_ENABLED。未配置时开发/测试保持开启，生产默认关闭，
 * 这样不会因为忘记补一个临时环境变量而意外开放内测入口。
 */
export const PUBLIC_AUTH_CLOSED_MESSAGE = "登录功能暂未开放，仅对内测用户开放";

export function isPublicAuthEnabled(environment: Record<string, string | undefined> = process.env): boolean {
  const configured = environment.PUBLIC_AUTH_ENABLED?.trim() || environment.NEXT_PUBLIC_PUBLIC_AUTH_ENABLED?.trim();
  if (!configured) return environment.NODE_ENV !== "production";
  return configured.toLowerCase() === "true";
}
