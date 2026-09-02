"use client";

import { Github, LockKeyhole, Mail } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { isPublicAuthEnabled, PUBLIC_AUTH_CLOSED_MESSAGE } from "@/lib/auth/public-access";

type LoginIntent = "login" | "create" | "upload" | "contribute";

interface LoginGateDialogProps {
  open: boolean;
  intent: LoginIntent;
  onOpenChange: (open: boolean) => void;
}

const intentCopy: Record<LoginIntent, { title: string; description: string }> = {
  login: { title: "登录开放知识平台", description: "登录后可同步草稿、提交修改申请并保留贡献署名。" },
  create: { title: "登录后创建项目", description: "空白项目会先创建为私人草稿，确认来源和许可证后再公开。" },
  upload: { title: "登录后上传报告", description: "上传文件需要登录并经过私有 OSS、文件校验和解析流程。" },
  contribute: { title: "登录后提交贡献", description: "游客可以阅读和使用 AI；创建合并申请与永久署名需要登录。" },
};

function openLogin(intent: LoginIntent): void {
  const callbackUrl = intent === "upload" ? "/upload" : `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const params = new URLSearchParams({ callbackUrl, intent });
  window.location.assign(`/login?${params.toString()}`);
}

/** 登录门槛保留用户原动作，跳转真实 Auth.js 页面；不在弹窗内伪造会话。 */
export function LoginGateDialog({ open, intent, onOpenChange }: LoginGateDialogProps) {
  const copy = intentCopy[intent];
  const authEnabled = isPublicAuthEnabled();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="login-dialog">
        <div className="login-dialog__icon"><LockKeyhole size={20} /></div>
        {authEnabled ? <>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
          <div className="login-options">
            <Button onClick={() => openLogin(intent)}><Github size={17} />登录或注册</Button>
            <Button variant="outline" onClick={() => openLogin(intent)}><Mail size={17} />使用邮箱和密码</Button>
          </div>
          <p className="login-status">登录后会返回你刚才的操作；游客的公开阅读和 AI 体验不受影响。</p>
        </> : <>
          <DialogTitle>{PUBLIC_AUTH_CLOSED_MESSAGE}</DialogTitle>
          <DialogDescription>当前不接受登录、注册、上传、创建项目或提交贡献申请。公开研究、搜索和 AI 助手仍可使用。</DialogDescription>
          <div className="login-options"><Button onClick={() => onOpenChange(false)}>知道了</Button></div>
        </>}
      </DialogContent>
    </Dialog>
  );
}
