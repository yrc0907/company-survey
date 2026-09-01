"use client";

import { Github, Loader2, LockKeyhole, Mail, UserRound } from "lucide-react";
import { getProviders, signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";

type AuthMode = "login" | "register";

function safeCallback(value: string | null): string {
  if (!value) return "/";
  try {
    const parsed = new URL(value, window.location.origin);
    if (parsed.origin !== window.location.origin || !parsed.pathname.startsWith("/")) return "/";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}

/** Auth.js Credentials 表单；注册先调用平台 API，再使用同一 Credentials Provider 建立 Session。 */
export function AuthForm() {
  const params = useSearchParams();
  const callbackUrl = useMemo(() => safeCallback(params.get("callbackUrl")), [params]);
  const [mode, setMode] = useState<AuthMode>(params.get("intent") === "login" ? "login" : "register");
  const [identifier, setIdentifier] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [githubEnabled, setGithubEnabled] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void getProviders().then((providers) => { if (active) setGithubEnabled(Boolean(providers?.github)); }).catch(() => { if (active) setGithubEnabled(false); });
    return () => { active = false; };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (mode === "register" && password !== confirmPassword) { setError("两次输入的密码不一致"); return; }
    setPending(true);
    try {
      if (mode === "register") {
        const response = await fetch("/api/platform/account/register", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, username, displayName: displayName || undefined, password }),
        });
        const payload = await response.json() as { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "注册失败，请检查输入");
        setIdentifier(email);
      }
      const result = await signIn("credentials", { identifier: mode === "register" ? email : identifier, password, redirect: false, callbackUrl });
      if (!result || result.error) throw new Error("账号或密码错误");
      window.location.assign(result.url ?? callbackUrl);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "认证失败，请稍后重试");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-12 text-foreground">
      <section className="w-full max-w-md rounded-xl border bg-background p-7 shadow-sm">
        <div className="mb-7 flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground"><LockKeyhole size={18} /></span><div><h1 className="text-xl font-semibold">开放知识平台</h1><p className="text-sm text-muted-foreground">保存草稿、提交贡献并保留署名</p></div></div>
        <div className="mb-5 grid grid-cols-2 rounded-lg bg-muted p-1" role="tablist" aria-label="认证模式">
          <button type="button" role="tab" aria-selected={mode === "login"} className={`rounded-md py-2 text-sm ${mode === "login" ? "bg-background font-medium shadow-sm" : "text-muted-foreground"}`} onClick={() => { setMode("login"); setError(""); }}>登录</button>
          <button type="button" role="tab" aria-selected={mode === "register"} className={`rounded-md py-2 text-sm ${mode === "register" ? "bg-background font-medium shadow-sm" : "text-muted-foreground"}`} onClick={() => { setMode("register"); setError(""); }}>注册</button>
        </div>
        {githubEnabled ? <><Button type="button" variant="outline" className="mb-4 w-full" disabled={pending} onClick={() => void signIn("github", { callbackUrl })}><Github size={16} />使用 GitHub {mode === "register" ? "注册" : "登录"}</Button><div className="mb-4 flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" /><span>或使用账号密码</span><span className="h-px flex-1 bg-border" /></div></> : null}
        <form className="space-y-4" onSubmit={submit}>
          {mode === "login" ? <label className="block text-sm"><span className="mb-1.5 block font-medium">邮箱或用户名</span><span className="relative block"><UserRound className="absolute left-3 top-2.5 text-muted-foreground" size={16} /><input required minLength={3} maxLength={320} autoComplete="username" value={identifier} onChange={(event) => setIdentifier(event.target.value)} className="h-10 w-full rounded-md border bg-background pl-9 pr-3 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring" placeholder="name@example.com 或用户名" /></span></label> : <><label className="block text-sm"><span className="mb-1.5 block font-medium">邮箱</span><span className="relative block"><Mail className="absolute left-3 top-2.5 text-muted-foreground" size={16} /><input required type="email" maxLength={320} autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="h-10 w-full rounded-md border bg-background pl-9 pr-3 outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder="name@example.com" /></span></label><label className="block text-sm"><span className="mb-1.5 block font-medium">用户名</span><input required minLength={3} maxLength={32} pattern="[A-Za-z0-9_\-\u4e00-\u9fff]+" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} className="h-10 w-full rounded-md border bg-background px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder="3-32 位中文、字母、数字、下划线或短横线" /></label><label className="block text-sm"><span className="mb-1.5 block font-medium">显示名称（可选）</span><input maxLength={80} value={displayName} onChange={(event) => setDisplayName(event.target.value)} className="h-10 w-full rounded-md border bg-background px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring" /></label></>}
          <label className="block text-sm"><span className="mb-1.5 block font-medium">密码</span><input required type="password" minLength={10} maxLength={128} autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} className="h-10 w-full rounded-md border bg-background px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder="至少 10 位，包含字母和数字" /></label>
          {mode === "register" ? <label className="block text-sm"><span className="mb-1.5 block font-medium">确认密码</span><input required type="password" minLength={10} maxLength={128} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="h-10 w-full rounded-md border bg-background px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring" /></label> : null}
          {error ? <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{error}</p> : null}
          <Button type="submit" className="w-full" disabled={pending}>{pending ? <Loader2 size={16} className="animate-spin" /> : null}{mode === "login" ? "登录" : "创建账号"}</Button>
        </form>
        <p className="mt-5 text-center text-xs text-muted-foreground">继续即表示你同意只提交有权公开或贡献的内容。公开项目可匿名阅读。</p>
      </section>
    </main>
  );
}

