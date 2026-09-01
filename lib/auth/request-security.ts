import { ValidationError } from "@/lib/domain/errors";

/** 自定义注册写接口校验 JSON 与同源 Origin；无 Origin 的服务端客户端仍需走 HTTPS 与限流层。 */
export function assertTrustedJsonRequest(request: Request): void {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) throw new ValidationError("请求必须使用 JSON");
  const origin = request.headers.get("origin");
  if (!origin) return;
  const expectedOrigin = process.env.NEXTAUTH_URL ? new URL(process.env.NEXTAUTH_URL).origin : new URL(request.url).origin;
  if (origin !== expectedOrigin) throw new ValidationError("拒绝跨站写入请求");
}
