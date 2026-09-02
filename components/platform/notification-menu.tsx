"use client";

import { Bell, CheckCheck, ExternalLink, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

interface NotificationItem {
  id: string;
  kind: string;
  actor: { username: string; displayName: string } | null;
  project: { id: string; title: string } | null;
  targetType: string;
  targetId: string;
  readAt: string | null;
  createdAt: string;
}

interface NotificationPayload { items?: NotificationItem[]; unreadCount?: number; }

const labels: Record<string, string> = {
  comment_reply: "回复了你的评论", comment_mention: "在评论中提到了你", comment_liked: "赞了你的评论", project_starred: "收藏了你的项目",
  author_followed: "关注了你", merge_request_opened: "提交了修改申请", merge_request_reviewed: "审核了修改申请",
  merge_request_merged: "合并了修改申请", system: "系统通知",
};

function relativeTime(value: string): string {
  const delta = Math.max(0, Date.now() - Date.parse(value));
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

/** GitHub 风格通知菜单；未登录或接口返回 401 时不渲染入口，避免出现失效按钮。 */
export function NotificationMenu(): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  async function load(): Promise<void> {
    setLoading(true);
    try {
      const response = await fetch("/api/platform/notifications?limit=20", { cache: "no-store", headers: { accept: "application/json" } });
      if (response.status === 401) { setAvailable(false); setLoaded(true); return; }
      const payload = await response.json() as NotificationPayload;
      if (!response.ok) throw new Error("通知读取失败");
      setItems(Array.isArray(payload.items) ? payload.items : []);
      setUnreadCount(Number(payload.unreadCount ?? 0));
      setAvailable(true);
      setLoaded(true);
    } catch {
      setLoaded(true);
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);
  if (!loaded || available === false) return null;

  async function markAllRead(): Promise<void> {
    const response = await fetch("/api/platform/notifications/read-all", { method: "POST", headers: { "content-type": "application/json" } });
    if (response.ok) { setUnreadCount(0); setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() }))); }
  }

  async function openTarget(item: NotificationItem): Promise<void> {
    if (!item.readAt) await fetch(`/api/platform/notifications/${encodeURIComponent(item.id)}/read`, { method: "POST", headers: { "content-type": "application/json" } });
    setOpen(false);
    if (item.project?.id) {
      const url = new URL(window.location.origin);
      url.pathname = "/";
      url.searchParams.set("project", item.project.id);
      if (item.targetType === "comment") url.searchParams.set("comment", item.targetId);
      window.location.assign(`${url.pathname}${url.search}`);
    }
  }

  return <div className="relative">
    <Button variant="ghost" size="icon" aria-label="通知" title="通知" onClick={() => { setOpen((current) => !current); if (!loaded) void load(); }}>
      <Bell size={16} />{unreadCount > 0 ? <span className="absolute right-1 top-1 grid min-w-4 translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-destructive px-1 text-[9px] leading-4 text-destructive-foreground">{unreadCount > 99 ? "99+" : unreadCount}</span> : null}
    </Button>
    {open ? <div className="absolute right-0 top-11 z-50 w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-xl border bg-background shadow-xl" role="dialog" aria-label="通知列表">
      <div className="flex items-center justify-between border-b px-4 py-3"><strong className="text-sm">通知</strong><Button size="sm" variant="ghost" disabled={!unreadCount} onClick={() => void markAllRead()}><CheckCheck size={14} />全部已读</Button></div>
      {loading ? <div className="flex items-center justify-center gap-2 px-4 py-8 text-xs text-muted-foreground"><Loader2 size={14} className="animate-spin" />正在读取通知…</div> : null}
      {!loading && items.length === 0 ? <p className="px-4 py-8 text-center text-xs text-muted-foreground">暂无通知</p> : null}
      {!loading && items.length > 0 ? <ul className="max-h-80 overflow-y-auto">{items.map((item) => <li key={item.id}><button type="button" className={`flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted/60 ${item.readAt ? "" : "bg-muted/35"}`} onClick={() => openTarget(item)}><span className={`mt-1 size-2 shrink-0 rounded-full ${item.readAt ? "bg-border" : "bg-foreground"}`} /><span className="min-w-0 flex-1 text-xs leading-5"><span><strong>{item.actor?.displayName ?? "系统"}</strong> {labels[item.kind] ?? "更新了一个项目"}</span>{item.project ? <span className="flex items-center gap-1 text-muted-foreground"><span className="truncate">{item.project.title}</span><ExternalLink size={11} /></span> : null}<time className="block text-[10px] text-muted-foreground">{relativeTime(item.createdAt)}</time></span></button></li>)}</ul> : null}
    </div> : null}
  </div>;
}
