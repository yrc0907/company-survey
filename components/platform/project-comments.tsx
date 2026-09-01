"use client";

import { CornerDownRight, Loader2, MessageCircle, RefreshCw, Reply, Send, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { UserAvatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { ProjectCommentSummary } from "@/lib/domain/collaboration";

interface ProjectCommentsProps {
  projectId: string;
  authenticated: boolean;
  onRequireLogin: () => void;
  onCountChange?: (count: number) => void;
}

interface CommentResponse { comments?: ProjectCommentSummary[]; comment?: ProjectCommentSummary; error?: string; }

/** 将仓储返回的平铺评论按 parentId 组织为树；非法孤儿节点降级到根层而不丢内容。 */
type OrderedComment = ProjectCommentSummary & { depth: number };

function commentTree(comments: ProjectCommentSummary[]): OrderedComment[] {
  const byParent = new Map<string | null, ProjectCommentSummary[]>();
  for (const comment of comments) {
    const parent = comment.parentId && comments.some((candidate) => candidate.id === comment.parentId) ? comment.parentId : null;
    const list = byParent.get(parent) ?? [];
    list.push(comment);
    byParent.set(parent, list);
  }
  const output: OrderedComment[] = [];
  const visited = new Set<string>();
  const visit = (comment: ProjectCommentSummary, depth: number): void => {
    if (visited.has(comment.id)) return;
    visited.add(comment.id);
    output.push({ ...comment, depth });
    if (depth >= 8) return;
    for (const child of byParent.get(comment.id) ?? []) visit(child, depth + 1);
  };
  for (const root of byParent.get(null) ?? []) visit(root, 0);
  // 数据库约束已禁止跨项目父节点；若历史数据形成环，仍将未访问节点展示在根层而不是丢失。
  for (const comment of comments) if (!visited.has(comment.id)) visit(comment, 0);
  return output;
}

function relativeDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return date.toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" });
}

/** 项目级楼中楼评论：读取可匿名，写入与删除由服务端 Session/权限决定。 */
export function ProjectComments({ projectId, authenticated, onRequireLogin, onCountChange }: ProjectCommentsProps) {
  const [comments, setComments] = useState<ProjectCommentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<ProjectCommentSummary | null>(null);
  const [submitState, setSubmitState] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [submitError, setSubmitError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/platform/projects/${encodeURIComponent(projectId)}/comments`, { cache: "no-store", credentials: "same-origin" });
      const payload = await response.json().catch(() => ({})) as CommentResponse;
      if (!response.ok) throw new Error(payload.error ?? "评论暂时无法加载");
      const nextComments = payload.comments ?? [];
      setComments(nextComments);
      onCountChange?.(nextComments.filter((comment) => !comment.deleted).length);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "评论暂时无法加载");
    } finally {
      setLoading(false);
    }
  }, [onCountChange, projectId]);

  useEffect(() => { void load(); }, [load]);

  const orderedComments = useMemo(() => commentTree(comments), [comments]);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!authenticated) { onRequireLogin(); return; }
    const value = body.trim();
    if (!value || submitState === "saving") return;
    setSubmitState("saving");
    setSubmitError("");
    try {
      const response = await fetch(`/api/platform/projects/${encodeURIComponent(projectId)}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", "Idempotency-Key": crypto.randomUUID() },
        credentials: "same-origin",
        body: JSON.stringify({ parentId: replyTo?.id ?? null, body: value }),
      });
      const payload = await response.json().catch(() => ({})) as CommentResponse;
      if (!response.ok || !payload.comment) throw new Error(payload.error ?? "评论发布失败");
      setComments((current) => [...current, payload.comment!]);
      onCountChange?.(comments.filter((comment) => !comment.deleted).length + (payload.comment.deleted ? 0 : 1));
      setBody("");
      setReplyTo(null);
      setSubmitState("success");
    } catch (requestError) {
      setSubmitState("error");
      setSubmitError(requestError instanceof Error ? requestError.message : "评论发布失败");
    }
  }

  async function remove(comment: ProjectCommentSummary): Promise<void> {
    if (!comment.canDelete || deletingId) return;
    setDeletingId(comment.id);
    setDeleteError("");
    try {
      const response = await fetch(`/api/platform/projects/${encodeURIComponent(projectId)}/comments/${encodeURIComponent(comment.id)}`, {
        method: "DELETE", headers: { accept: "application/json" }, credentials: "same-origin",
      });
      const payload = await response.json().catch(() => ({})) as CommentResponse;
      if (!response.ok || !payload.comment) throw new Error(payload.error ?? "评论删除失败");
      setComments((current) => current.map((item) => item.id === comment.id ? payload.comment! : item));
      if (!comment.deleted && payload.comment.deleted) onCountChange?.(Math.max(0, comments.filter((item) => !item.deleted).length - 1));
    } catch (requestError) {
      setDeleteError(requestError instanceof Error ? requestError.message : "评论删除失败");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="mx-auto mt-8 w-full max-w-[860px] border-t px-5 pb-20 pt-7 sm:px-14" aria-labelledby="project-comments-title">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2"><MessageCircle size={17} aria-hidden="true" /><h2 id="project-comments-title" className="m-0 text-base font-semibold">讨论</h2><span className="text-xs text-muted-foreground">{comments.length} 条</span></div>
        <Button size="icon" variant="ghost" onClick={() => void load()} disabled={loading} aria-label="刷新评论" title="刷新评论"><RefreshCw size={15} className={loading ? "animate-spin" : undefined} /></Button>
      </div>

      {loading ? <div className="mt-5 grid gap-3" aria-live="polite" aria-busy="true"><Skeleton className="h-4 w-1/3" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-2/3" /><span className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 size={14} className="animate-spin" />加载讨论…</span></div> : null}
      {!loading && error ? <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="alert"><span>{error}</span><Button size="sm" variant="outline" onClick={() => void load()}>重试</Button></div> : null}
      {!loading && !error && orderedComments.length === 0 ? <p className="mt-5 text-sm text-muted-foreground">还没有讨论，成为第一个发言的人。</p> : null}

      {!loading && !error && orderedComments.length ? <div className="mt-5 divide-y divide-border rounded-md border">{orderedComments.map((comment) => {
        return <article key={comment.id} className="p-4" style={{ marginLeft: comment.depth ? `${Math.min(comment.depth, 4) * 16}px` : undefined }}>
          <div className="flex items-start gap-3"><UserAvatar name={comment.authorDisplayName || comment.authorUsername} size="sm" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"><strong>{comment.authorDisplayName || comment.authorUsername}</strong><span className="text-muted-foreground">@{comment.authorUsername}</span><time className="text-muted-foreground" dateTime={comment.createdAt}>{relativeDate(comment.createdAt)}</time></div><p className={comment.deleted ? "mt-2 text-sm italic text-muted-foreground" : "mt-2 whitespace-pre-wrap text-sm leading-6"}>{comment.deleted ? "该评论已删除" : comment.body}</p><div className="mt-3 flex flex-wrap items-center gap-2"><Button size="sm" variant="ghost" onClick={() => { setReplyTo(comment); setSubmitState("idle"); setSubmitError(""); }}><Reply size={13} />回复</Button>{comment.canDelete && !comment.deleted ? <Button size="sm" variant="ghost" className="text-destructive" onClick={() => void remove(comment)} disabled={deletingId === comment.id}>{deletingId === comment.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}删除</Button> : null}</div></div></div>
        </article>;
      })}</div> : null}
      {deleteError ? <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="alert">{deleteError}</p> : null}

      <form className="mt-6 rounded-md border bg-muted/20 p-4" onSubmit={(event) => void submit(event)}>
        {replyTo ? <div className="mb-3 flex items-center justify-between gap-2 border-l-2 border-foreground pl-3 text-xs text-muted-foreground"><span className="flex items-center gap-1"><CornerDownRight size={13} />回复 @{replyTo.authorUsername}</span><Button type="button" size="icon" variant="ghost" aria-label="取消回复" title="取消回复" onClick={() => setReplyTo(null)}><X size={14} /></Button></div> : null}
        <textarea value={body} onChange={(event) => { setBody(event.target.value); if (submitState !== "idle") setSubmitState("idle"); }} placeholder={authenticated ? "写下你的看法…" : "登录后参与讨论"} rows={3} maxLength={10000} disabled={submitState === "saving"} className="min-h-24 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring" aria-label="评论内容" />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><span className="text-xs text-muted-foreground">{body.length}/10000 · {authenticated ? "评论会显示你的真实用户资料" : "匿名仅可阅读"}</span><Button type="submit" size="sm" disabled={!body.trim() || submitState === "saving"}>{submitState === "saving" ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}发布评论</Button></div>
        {submitState === "success" ? <p className="mt-2 text-xs text-foreground" role="status">评论已发布。</p> : null}
        {submitState === "error" ? <div className="mt-2 flex items-center justify-between gap-3 text-xs text-destructive" role="alert"><span>{submitError}</span><Button type="button" size="sm" variant="ghost" onClick={() => setSubmitState("idle")}>重试</Button></div> : null}
      </form>
    </section>
  );
}
