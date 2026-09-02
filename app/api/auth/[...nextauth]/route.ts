import NextAuth from "next-auth";

import { authOptions } from "@/lib/auth/options";
import { isPublicAuthEnabled, PUBLIC_AUTH_CLOSED_MESSAGE } from "@/lib/auth/public-access";
import { json } from "@/lib/api/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Auth.js 统一处理登录、登出、Session、CSRF 与 GitHub OAuth 回调。 */
const handler = NextAuth(authOptions);

/** 认证关闭时连 Auth.js Provider/CSRF 端点也不暴露，避免直接 API 调用绕过 UI 门槛。 */
async function guardedHandler(request: Request, context: { params: { nextauth?: string[] } }): Promise<Response> {
  if (!isPublicAuthEnabled()) return json({ error: PUBLIC_AUTH_CLOSED_MESSAGE, code: "AUTH_CLOSED" }, { status: 403 });
  return handler(request, context);
}

export const GET = guardedHandler;
export const POST = guardedHandler;
