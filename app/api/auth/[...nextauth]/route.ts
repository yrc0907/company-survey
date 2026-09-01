import NextAuth from "next-auth";

import { authOptions } from "@/lib/auth/options";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Auth.js 统一处理登录、登出、Session、CSRF 与 GitHub OAuth 回调。 */
const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
