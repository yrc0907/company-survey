import { Suspense } from "react";

import { AuthForm } from "@/components/platform/auth/auth-form";

/** 独立认证页面承接登录门槛，认证成功后由客户端安全返回原始同源路径。 */
export default function LoginPage() {
  return <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">正在加载登录页…</div>}><AuthForm /></Suspense>;
}

