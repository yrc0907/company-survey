"use client";

import { Github, Loader2, LockKeyhole, Mail, MessageSquareText, RotateCcw, UserRound } from "lucide-react";
import { getProviders, signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { CaptchaChallenge } from "@/components/platform/auth/captcha-challenge";

type AuthMode = "login" | "register" | "reset";
type LoginMethod = "password" | "code";
type CodeChannel = "email" | "sms";

function safeCallback(value: string | null): string {
  if (!value) return "/";
  try {
    const parsed = new URL(value, window.location.origin);
    if (parsed.origin !== window.location.origin || !parsed.pathname.startsWith("/")) return "/";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch { return "/"; }
}

/** 认证页面统一承载密码、邮箱验证码、短信验证码和密码找回流程。 */
export function AuthForm() {
  const params = useSearchParams();
  const callbackUrl = useMemo(() => safeCallback(params.get("callbackUrl")), [params]);
  const [mode, setMode] = useState<AuthMode>(params.get("intent") === "login" ? "login" : "register");
  const [loginMethod, setLoginMethod] = useState<LoginMethod>("password");
  const [codeChannel, setCodeChannel] = useState<CodeChannel>("email");
  const [identifier, setIdentifier] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [code, setCode] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [captchaTicket, setCaptchaTicket] = useState("");
  const [githubEnabled, setGithubEnabled] = useState(false);
  const [pending, setPending] = useState(false);
  const [codePending, setCodePending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    void getProviders().then((providers) => { if (active) setGithubEnabled(Boolean(providers?.github)); }).catch(() => { if (active) setGithubEnabled(false); });
    return () => { active = false; };
  }, []);

  const handleCaptchaChange = useCallback((value: string) => setCaptchaTicket(value), []);

  function resetMessages() { setError(""); setNotice(""); }

  async function requestCode(event?: FormEvent) {
    event?.preventDefault();
    resetMessages();
    const destination = mode === "reset" ? email : codeChannel === "email" ? identifier : phone;
    if (!destination.trim()) { setError(codeChannel === "email" || mode === "reset" ? "请先填写邮箱" : "请先填写手机号"); return; }
    setCodePending(true);
    try {
      const purpose = mode === "reset" ? "password_reset" : codeChannel === "email" ? "email_login" : "phone_login";
      const response = await fetch("/api/platform/account/verification/request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel: mode === "reset" ? "email" : codeChannel, purpose, destination, captchaTicket: captchaTicket || null, deviceId: window.navigator.userAgent.slice(0, 128) }) });
      const payload = await response.json() as { receipt?: { challengeId?: string; maskedDestination?: string }; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "验证码发送失败");
      setChallengeId(payload.receipt?.challengeId ?? "");
      setNotice(payload.receipt?.challengeId ? `验证码已发送至 ${payload.receipt.maskedDestination ?? "目标地址"}` : "如果账号存在，验证码会发送到对应地址");
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "验证码发送失败"); }
    finally { setCodePending(false); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetMessages();
    if ((mode === "register" || mode === "reset") && password !== confirmPassword) { setError("两次输入的密码不一致"); return; }
    setPending(true);
    try {
      if (mode === "register") {
        const response = await fetch("/api/platform/account/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, username, displayName: displayName || undefined, password }) });
        const payload = await response.json() as { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "注册失败，请检查输入");
        const result = await signIn("credentials", { identifier: email, password, redirect: false, callbackUrl });
        if (!result || result.error) throw new Error("注册成功，但自动登录失败");
        window.location.assign(result.url ?? callbackUrl);
        return;
      }
      if (mode === "reset") {
        if (!challengeId) throw new Error("请先获取邮箱验证码");
        const response = await fetch("/api/platform/account/password-reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ challengeId, destination: email, code, newPassword: password }) });
        const payload = await response.json() as { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "密码重置失败");
        setMode("login"); setLoginMethod("password"); setPassword(""); setCode(""); setChallengeId(""); setNotice("密码已重置，请使用新密码登录");
        return;
      }
      if (loginMethod === "code") {
        if (!challengeId) throw new Error("请先获取验证码");
        const result = await signIn("credentials", { identifier: codeChannel === "email" ? identifier : phone, challengeId, code, redirect: false, callbackUrl });
        if (!result || result.error) throw new Error("验证码无效或已过期");
        window.location.assign(result.url ?? callbackUrl);
        return;
      }
      const result = await signIn("credentials", { identifier, password, redirect: false, callbackUrl });
      if (!result || result.error) throw new Error("账号或密码错误");
      window.location.assign(result.url ?? callbackUrl);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "认证失败，请稍后重试"); }
    finally { setPending(false); }
  }

  const showingCode = mode === "login" && loginMethod === "code";
  const needsCaptcha = mode === "reset" || showingCode;

  return <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-12 text-foreground">
    <section className="w-full max-w-md rounded-xl border bg-background p-7 shadow-sm">
      <div className="mb-7 flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground"><LockKeyhole size={18} /></span><div><h1 className="text-xl font-semibold">研见</h1><p className="text-sm text-muted-foreground">保存研究、提交贡献并保留署名</p></div></div>
      {mode !== "reset" ? <div className="mb-5 grid grid-cols-2 rounded-lg bg-muted p-1" role="tablist" aria-label="认证模式"><button type="button" role="tab" aria-selected={mode === "login"} className={`rounded-md py-2 text-sm ${mode === "login" ? "bg-background font-medium shadow-sm" : "text-muted-foreground"}`} onClick={() => { setMode("login"); resetMessages(); }}>登录</button><button type="button" role="tab" aria-selected={mode === "register"} className={`rounded-md py-2 text-sm ${mode === "register" ? "bg-background font-medium shadow-sm" : "text-muted-foreground"}`} onClick={() => { setMode("register"); resetMessages(); }}>注册</button></div> : <button type="button" className="mb-5 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" onClick={() => { setMode("login"); resetMessages(); }}><RotateCcw size={14} />返回登录</button>}
      {githubEnabled && mode !== "reset" ? <><Button type="button" variant="outline" className="mb-4 w-full" disabled={pending} onClick={() => void signIn("github", { callbackUrl })}><Github size={16} />使用 GitHub {mode === "register" ? "注册" : "登录"}</Button><div className="mb-4 flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" /><span>或使用账号密码</span><span className="h-px flex-1 bg-border" /></div></> : null}
      {mode === "login" ? <div className="mb-4 grid grid-cols-2 rounded-md border p-1" role="tablist" aria-label="登录方式"><button type="button" role="tab" aria-selected={loginMethod === "password"} className={`rounded py-1.5 text-xs ${loginMethod === "password" ? "bg-muted font-medium" : "text-muted-foreground"}`} onClick={() => { setLoginMethod("password"); resetMessages(); }}>密码登录</button><button type="button" role="tab" aria-selected={loginMethod === "code"} className={`rounded py-1.5 text-xs ${loginMethod === "code" ? "bg-muted font-medium" : "text-muted-foreground"}`} onClick={() => { setLoginMethod("code"); resetMessages(); }}>验证码登录</button></div> : null}
      {showingCode ? <div className="mb-4 grid grid-cols-2 rounded-md bg-muted/60 p-1"><button type="button" className={`rounded py-1.5 text-xs ${codeChannel === "email" ? "bg-background font-medium" : "text-muted-foreground"}`} onClick={() => { setCodeChannel("email"); setChallengeId(""); }}>邮箱验证码</button><button type="button" className={`rounded py-1.5 text-xs ${codeChannel === "sms" ? "bg-background font-medium" : "text-muted-foreground"}`} onClick={() => { setCodeChannel("sms"); setChallengeId(""); }}>手机验证码</button></div> : null}
      <form className="space-y-4" onSubmit={submit}>
        {mode === "register" ? <><label className="block text-sm"><span className="mb-1.5 block font-medium">邮箱</span><span className="relative block"><Mail className="absolute left-3 top-2.5 text-muted-foreground" size={16} /><input required type="email" maxLength={320} autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="h-10 w-full rounded-md border bg-background pl-9 pr-3 outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder="name@example.com" /></span></label><label className="block text-sm"><span className="mb-1.5 block font-medium">用户名</span><input required minLength={3} maxLength={32} pattern="[A-Za-z0-9_\-\u4e00-\u9fff]+" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} className="h-10 w-full rounded-md border bg-background px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder="3-32 位中文、字母、数字、下划线或短横线" /></label><label className="block text-sm"><span className="mb-1.5 block font-medium">显示名称（可选）</span><input maxLength={80} value={displayName} onChange={(event) => setDisplayName(event.target.value)} className="h-10 w-full rounded-md border bg-background px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring" /></label></> : null}
        {mode === "reset" ? <label className="block text-sm"><span className="mb-1.5 block font-medium">邮箱</span><span className="relative block"><Mail className="absolute left-3 top-2.5 text-muted-foreground" size={16} /><input required type="email" maxLength={320} autoComplete="email" value={email} onChange={(event) => { setEmail(event.target.value); setChallengeId(""); }} className="h-10 w-full rounded-md border bg-background pl-9 pr-3 outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder="name@example.com" /></span></label> : null}
        {mode === "login" ? <label className="block text-sm"><span className="mb-1.5 block font-medium">{showingCode ? codeChannel === "email" ? "邮箱" : "手机号" : "邮箱或用户名"}</span><span className="relative block">{showingCode && codeChannel === "sms" ? <MessageSquareText className="absolute left-3 top-2.5 text-muted-foreground" size={16} /> : <UserRound className="absolute left-3 top-2.5 text-muted-foreground" size={16} />}<input required type={showingCode && codeChannel === "email" ? "email" : "text"} minLength={3} maxLength={320} autoComplete={showingCode ? codeChannel === "sms" ? "tel" : "email" : "username"} value={showingCode ? codeChannel === "email" ? identifier : phone : identifier} onChange={(event) => showingCode ? codeChannel === "email" ? (setIdentifier(event.target.value), setChallengeId("")) : (setPhone(event.target.value), setChallengeId("")) : setIdentifier(event.target.value)} className="h-10 w-full rounded-md border bg-background pl-9 pr-3 outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder={showingCode && codeChannel === "sms" ? "13800138000" : "name@example.com"} /></span></label> : null}
        {(mode === "register" || mode === "reset" || (mode === "login" && loginMethod === "password")) ? <label className="block text-sm"><span className="mb-1.5 block font-medium">{mode === "reset" ? "新密码" : "密码"}</span><input required type="password" minLength={10} maxLength={128} autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} className="h-10 w-full rounded-md border bg-background px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder="至少 10 位，包含字母和数字" /></label> : null}
        {mode === "register" || mode === "reset" ? <label className="block text-sm"><span className="mb-1.5 block font-medium">确认密码</span><input required type="password" minLength={10} maxLength={128} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="h-10 w-full rounded-md border bg-background px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring" /></label> : null}
        {needsCaptcha ? <CaptchaChallenge scene={`${codeChannel}:${mode}`} value={captchaTicket} onChange={handleCaptchaChange} disabled={pending || codePending} /> : null}
        {needsCaptcha ? <div className="flex gap-2"><input required inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} className="h-10 min-w-0 flex-1 rounded-md border bg-background px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder="6 位验证码" /><Button type="button" variant="outline" disabled={codePending || pending} onClick={() => void requestCode()}>{codePending ? <Loader2 size={15} className="animate-spin" /> : <MessageSquareText size={15} />}获取验证码</Button></div> : null}
        {error ? <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{error}</p> : null}
        {notice ? <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700" role="status">{notice}</p> : null}
        <Button type="submit" className="w-full" disabled={pending || codePending}>{pending ? <Loader2 size={16} className="animate-spin" /> : null}{mode === "login" ? "登录" : mode === "register" ? "创建账号" : "重置密码"}</Button>
      </form>
      {mode === "login" && loginMethod === "password" ? <button type="button" className="mt-4 block w-full text-center text-xs text-muted-foreground hover:text-foreground" onClick={() => { setMode("reset"); resetMessages(); }}>忘记密码？</button> : null}
      <p className="mt-5 text-center text-xs text-muted-foreground">继续即表示你同意只提交有权公开或贡献的内容。公开项目可匿名阅读。</p>
    </section>
  </main>;
}
