import { Suspense } from "react";

import { AuthForm } from "@/components/platform/auth/auth-form";
import { AuthClosedPage } from "@/components/platform/auth/auth-closed";
import { isPublicAuthEnabled } from "@/lib/auth/public-access";

// 认证开关是运行时配置，禁止 Next 在构建期缓存页面状态。
export const dynamic = "force-dynamic";

/** 独立认证页面承接登录门槛，认证成功后由客户端安全返回原始同源路径。 */
export default function LoginPage() {
  if (!isPublicAuthEnabled()) return <AuthClosedPage />;
  return <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">正在加载登录页…</div>}><AuthForm /></Suspense>;
}
