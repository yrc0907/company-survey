"use client";

import { ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    initAlicom4?: (options: Record<string, unknown>, callback: (captcha: AlicomCaptcha) => void) => void;
  }
}

interface AlicomCaptcha {
  appendTo?: (target: string | HTMLElement) => AlicomCaptcha;
  getValidate?: () => unknown;
  onSuccess?: (callback: () => void) => AlicomCaptcha;
  onFail?: (callback: () => void) => AlicomCaptcha;
  onError?: (callback: () => void) => AlicomCaptcha;
  onClose?: (callback: () => void) => AlicomCaptcha;
}

interface CaptchaChallengeProps {
  scene: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

/** 阿里云图形验证桥接：成功回调写入一次性票据，服务端仍会再次校验。 */
export function CaptchaChallenge({ scene, value, onChange, disabled = false }: CaptchaChallengeProps) {
  const elementRef = useRef<HTMLDivElement>(null);
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(false);
  const appId = process.env.NEXT_PUBLIC_ALIYUN_CAPTCHA_APP_ID?.trim();
  const sceneLabel = scene.trim();

  useEffect(() => {
    if (!appId || !elementRef.current) return;
    let cancelled = false;
    setLoading(true);
    const initialize = () => {
      if (cancelled || !window.initAlicom4 || !elementRef.current) return;
      window.initAlicom4({
        captchaId: appId,
        product: "bind",
      }, (captcha) => {
        if (cancelled) return;
        const mounted = captcha.appendTo?.(elementRef.current!);
        (mounted ?? captcha).onSuccess?.(() => { const result = captcha.getValidate?.(); if (result && typeof result === "object") onChange(JSON.stringify(result)); });
        (mounted ?? captcha).onFail?.(() => onChange(""));
        (mounted ?? captcha).onError?.(() => onChange(""));
        (mounted ?? captcha).onClose?.(() => onChange(""));
        setConfigured(true);
        setLoading(false);
      });
    };
    if (window.initAlicom4) initialize();
    else {
      const script = document.createElement("script");
      script.src = "https://static.alicaptcha.com/v4/ct4.js";
      script.async = true;
      script.onload = initialize;
      script.onerror = () => { if (!cancelled) setLoading(false); };
      document.head.appendChild(script);
    }
    return () => { cancelled = true; };
  }, [appId, onChange]);

  if (!appId) {
    return <label className="block text-sm"><span className="mb-1.5 block font-medium">图形验证票据</span><input value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} className="h-10 w-full rounded-md border bg-background px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder="配置验证码方案后由组件自动填入" autoComplete="one-time-code" /></label>;
  }

  return <div className="space-y-1.5"><span className="block text-sm font-medium">图形验证</span><div ref={elementRef} data-scene={sceneLabel} aria-live="polite" className="flex min-h-10 items-center gap-2 rounded-md border bg-muted/30 px-3 text-sm text-muted-foreground"><ShieldCheck size={16} />{loading ? "正在加载验证组件…" : configured && value ? "验证通过，可发送验证码" : "点击此处完成图形验证"}</div></div>;
}
