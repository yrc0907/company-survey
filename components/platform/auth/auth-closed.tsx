"use client";

import { ArrowLeft, LockKeyhole } from "lucide-react";

import { Button } from "@/components/ui/button";

/** 认证暂未开放时的统一落地页；不渲染 AuthForm，也不触发任何 Provider。 */
export function AuthClosedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-12 text-foreground">
      <section className="w-full max-w-md rounded-xl border bg-background p-7 text-center shadow-sm">
        <span className="mx-auto grid size-11 place-items-center rounded-lg bg-secondary text-primary"><LockKeyhole size={20} /></span>
        <h1 className="mb-0 mt-4 text-xl font-semibold">登录功能暂未开放</h1>
        <p className="mb-0 mt-2 text-sm leading-6 text-muted-foreground">仅对内测用户开放。公开研究、搜索和 AI 助手仍可匿名使用。</p>
        <Button variant="outline" className="mt-6" onClick={() => window.location.assign("/")}><ArrowLeft size={15} />返回公开知识</Button>
      </section>
    </main>
  );
}
