"use client";

import * as AvatarPrimitive from "@radix-ui/react-avatar";
import * as React from "react";

import { cn } from "@/lib/ui/cn";
import { avatarInitial, avatarTone } from "@/lib/ui/platform-format";

const tones = ["avatar-tone-0", "avatar-tone-1", "avatar-tone-2", "avatar-tone-3", "avatar-tone-4", "avatar-tone-5"];

interface UserAvatarProps {
  name: string;
  src?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

/** 未上传头像时稳定生成首字符头像，不触发 OSS 或外部图片请求。 */
export function UserAvatar({ name, src, size = "md", className }: UserAvatarProps) {
  return (
    <AvatarPrimitive.Root className={cn("user-avatar", `user-avatar--${size}`, className)}>
      {src ? <AvatarPrimitive.Image alt={`${name}的头像`} className="size-full object-cover" src={src} /> : null}
      <AvatarPrimitive.Fallback className={cn("user-avatar__fallback", tones[avatarTone(name)])} delayMs={src ? 250 : 0}>
        {avatarInitial(name)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}
