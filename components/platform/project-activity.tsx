"use client";

import { Activity, AlertCircle, CheckCircle2, GitCommitHorizontal, GitPullRequest, Loader2, MessageCircle, RefreshCw, Star, UserRound } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { PublicProjectActivityEvent } from "@/lib/repositories/platform/platform-repository";

interface ProjectActivityProps { projectId: string; onSelect?: (event: PublicProjectActivityEvent) => void; }
interface ActivityResponse { events?: PublicProjectActivityEvent[]; error?: string; }

const eventLabels: Record<PublicProjectActivityEvent["eventType"], string> = {
  project_created: "创建了项目",
  commit_created: "提交了修改",
  merge_request_opened: "发起了修改申请",
  merge_request_merged: "合并了修改申请",
  review_submitted: "提交了审核意见",
  comment_created: "发表评论",
  project_starred: "收藏了项目",
  project_unstarred: "取消收藏项目",
};

function eventIcon(type: PublicProjectActivityEvent["eventType"]): JSX.Element {
  if (type.startsWith("merge_request")) return <GitPullRequest size={15} aria-hidden="true" />;
  if (type === "commit_created") return <GitCommitHorizontal size={15} aria-hidden="true" />;
  if (type === "comment_created") return <MessageCircle size={15} aria-hidden="true" />;
  if (type.startsWith("project_starred") || type === "project_unstarred") return <Star size={15} aria-hidden="true" />;
  if (type === "review_submitted") return <CheckCircle2 size={15} aria-hidden="true" />;
  return <UserRound size={15} aria-hidden="true" />;
}

function timeLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "时间未知" : date.toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" });
}

/**
 * 公开项目活动时间线：读取真实 append-only 事件，不从聚合数字推测行为。
 * 每个状态都有可恢复动作；事件详情由父级处理，避免组件自行修改项目事实。
 */
export function ProjectActivity({ projectId, onSelect }: ProjectActivityProps) {
  const [events, setEvents] = useState<PublicProjectActivityEvent[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setState("loading");
    setError("");
    try {
      const response = await fetch(`/api/platform/projects/${encodeURIComponent(projectId)}/activity?limit=100`, { headers: { accept: "application/json" }, cache: "no-store" });
      const payload = await response.json().catch(() => ({})) as ActivityResponse;
      if (!response.ok) throw new Error(payload.error ?? "活动时间线暂时无法加载");
      setEvents(Array.isArray(payload.events) ? payload.events : []);
      setState("ready");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "活动时间线暂时无法加载");
      setState("error");
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  return <section className="project-activity-panel" aria-labelledby="project-activity-title">
    <div className="project-activity-panel__heading"><div><span className="text-xs text-muted-foreground">公开项目</span><h1 id="project-activity-title">活动时间线</h1><p>只展示数据库中可回溯的项目事件。</p></div><Button size="icon" variant="ghost" onClick={() => void load()} disabled={state === "loading"} aria-label="刷新活动时间线" title="刷新活动时间线"><RefreshCw size={15} className={state === "loading" ? "animate-spin" : undefined} /></Button></div>
    {state === "loading" ? <div className="project-activity-loading" aria-live="polite" aria-busy="true"><Skeleton className="h-4 w-1/2" /><Skeleton className="h-3 w-4/5" /><span><Loader2 size={14} className="animate-spin" />读取活动…</span></div> : null}
    {state === "error" ? <div className="project-activity-error" role="alert"><AlertCircle size={16} /><span>{error}</span><Button size="sm" variant="outline" onClick={() => void load()}>重试</Button></div> : null}
    {state === "ready" && events.length === 0 ? <div className="project-activity-empty"><Activity size={22} /><p>还没有可公开展示的活动。</p></div> : null}
    {state === "ready" && events.length > 0 ? <ol className="project-activity-list">{events.map((event) => {
      const title = typeof event.metadata.title === "string" ? event.metadata.title : typeof event.metadata.message === "string" ? event.metadata.message : "查看事件详情";
      return <li key={event.id}><button type="button" className="project-activity-event" onClick={() => onSelect?.(event)}><span className="project-activity-event__icon">{eventIcon(event.eventType)}</span><span className="project-activity-event__body"><strong>{event.actor.displayName} <span>{eventLabels[event.eventType]}</span></strong><small>{title}</small><time dateTime={event.occurredAt}>{timeLabel(event.occurredAt)}</time></span><span className="project-activity-event__target">{event.targetType}</span></button></li>;
    })}</ol> : null}
  </section>;
}
