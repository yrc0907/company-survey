"use client";

/* 私有 OSS 的短期签名 URL 动态生成，不能安全加入 Next Image 的固定远程域名白名单。 */
/* eslint-disable @next/next/no-img-element */

import { AlertCircle, CheckCircle2, CornerDownRight, FileImage, Loader2, MessageCircle, RefreshCw, Reply, Send, Trash2, UploadCloud, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { UserAvatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { ProjectCommentSummary } from "@/lib/domain/collaboration";

interface ProjectCommentsProps {
  projectId: string;
  authenticated: boolean;
  onRequireLogin: () => void;
  onCountChange?: (count: number) => void;
  initialAnchor?: CommentAnchor | null;
}

interface CommentResponse { comments?: ProjectCommentSummary[]; comment?: ProjectCommentSummary; error?: string; }
export interface CommentAnchor { nodeId: string; blockId: string; quote: string; label: string; }
interface PendingAttachment { id: string; file: File; state: "queued" | "uploading" | "ready" | "failed"; assetId?: string; progress: number; error?: string; }

const COMMENT_ATTACHMENT_MAX = 4;
const COMMENT_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
const COMMENT_ATTACHMENT_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function attachmentType(file: File): string {
  if (COMMENT_ATTACHMENT_TYPES.has(file.type)) return file.type;
  const extension = file.name.toLowerCase().split(".").pop();
  return extension === "png" ? "image/png" : extension === "jpg" || extension === "jpeg" ? "image/jpeg" : extension === "webp" ? "image/webp" : extension === "gif" ? "image/gif" : "";
}

/** 使用现有上传意图/私有 OSS/完成校验接口上传评论图片，不把文件内容发给评论 API。 */
async function uploadCommentAttachment(file: File, onProgress: (progress: number) => void): Promise<string> {
  const contentType = attachmentType(file);
  if (!contentType) throw new Error("仅支持 PNG、JPEG、WebP 或 GIF 图片");
  if (file.size < 1 || file.size > COMMENT_ATTACHMENT_MAX_BYTES) throw new Error("附件必须在 1 byte 到 25 MiB 之间");
  const hash = await sha256(file);
  const intentResponse = await fetch("/api/platform/uploads", { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, credentials: "same-origin", body: JSON.stringify({ filename: file.name, contentType, size: file.size, sha256: hash, clientUploadId: crypto.randomUUID() }) });
  const intent = await intentResponse.json().catch(() => ({})) as { asset?: { id: string }; upload?: { url: string; requiredHeaders: Record<string, string> }; error?: string };
  if (!intentResponse.ok || !intent.asset?.id || !intent.upload) throw new Error(intent.error ?? "创建附件上传意图失败");
  const etag = await new Promise<string>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", intent.upload!.url);
    Object.entries(intent.upload!.requiredHeaders).forEach(([name, value]) => { if (value) request.setRequestHeader(name, value); });
    request.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100)); };
    request.onload = () => {
      if (request.status < 200 || request.status >= 300) { reject(new Error(`OSS 附件上传失败（${request.status}）`)); return; }
      const value = request.getResponseHeader("ETag")?.replace(/^"|"$/g, "") ?? "";
      if (!value) { reject(new Error("OSS 未暴露 ETag，请在 Bucket CORS 中添加 ExposeHeader: ETag 后重试")); return; }
      resolve(value);
    };
    request.onerror = () => reject(new Error("网络中断，OSS 附件上传失败"));
    request.send(file);
  });
  const completeResponse = await fetch(`/api/platform/uploads/${encodeURIComponent(intent.asset.id)}/complete`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, credentials: "same-origin", body: JSON.stringify({ etag, size: file.size, sha256: hash }) });
  const complete = await completeResponse.json().catch(() => ({})) as { error?: string };
  if (!completeResponse.ok) throw new Error(complete.error ?? "附件完整性校验失败");
  onProgress(100);
  return intent.asset.id;
}

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
export function ProjectComments({ projectId, authenticated, onRequireLogin, onCountChange, initialAnchor = null }: ProjectCommentsProps) {
  const [comments, setComments] = useState<ProjectCommentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<ProjectCommentSummary | null>(null);
  const [anchor, setAnchor] = useState<CommentAnchor | null>(initialAnchor);
  const [submitState, setSubmitState] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [submitError, setSubmitError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState("");
  const attachmentInputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => { setAnchor(initialAnchor); }, [initialAnchor]);

  const orderedComments = useMemo(() => commentTree(comments), [comments]);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!authenticated) { onRequireLogin(); return; }
    const value = body.trim();
    if (!value || submitState === "saving") return;
    setSubmitState("saving");
    setSubmitError("");
    try {
      const attachmentAssetIds: string[] = [];
      for (const pending of pendingAttachments) {
        if (pending.state === "ready" && pending.assetId) { attachmentAssetIds.push(pending.assetId); continue; }
        setPendingAttachments((current) => current.map((item) => item.id === pending.id ? { ...item, state: "uploading", progress: 0, error: undefined } : item));
        try {
          const assetId = await uploadCommentAttachment(pending.file, (progress) => setPendingAttachments((current) => current.map((item) => item.id === pending.id ? { ...item, progress } : item)));
          attachmentAssetIds.push(assetId);
          setPendingAttachments((current) => current.map((item) => item.id === pending.id ? { ...item, state: "ready", assetId, progress: 100 } : item));
        } catch (error) {
          const message = error instanceof Error ? error.message : "附件上传失败";
          setPendingAttachments((current) => current.map((item) => item.id === pending.id ? { ...item, state: "failed", error: message } : item));
          throw new Error(`${pending.file.name}：${message}`);
        }
      }
      const response = await fetch(`/api/platform/projects/${encodeURIComponent(projectId)}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", "Idempotency-Key": crypto.randomUUID() },
        credentials: "same-origin",
        body: JSON.stringify({ parentId: replyTo?.id ?? null, nodeId: anchor?.nodeId ?? null, blockId: anchor?.blockId ?? null, quote: anchor?.quote ?? null, body: value, attachmentAssetIds }),
      });
      const payload = await response.json().catch(() => ({})) as CommentResponse;
      if (!response.ok || !payload.comment) throw new Error(payload.error ?? "评论发布失败");
      setComments((current) => [...current, payload.comment!]);
      onCountChange?.(comments.filter((comment) => !comment.deleted).length + (payload.comment.deleted ? 0 : 1));
      setBody("");
      setReplyTo(null);
      setAnchor(null);
      setPendingAttachments([]);
      setAttachmentError("");
      setSubmitState("success");
    } catch (requestError) {
      setSubmitState("error");
      setSubmitError(requestError instanceof Error ? requestError.message : "评论发布失败");
    }
  }

  function selectAttachments(files: FileList | null): void {
    if (!files?.length) return;
    setAttachmentError("");
    const incoming = Array.from(files);
    const slots = COMMENT_ATTACHMENT_MAX - pendingAttachments.length;
    if (slots <= 0) { setAttachmentError(`一条评论最多添加 ${COMMENT_ATTACHMENT_MAX} 个附件`); return; }
    const accepted: PendingAttachment[] = [];
    for (const file of incoming.slice(0, slots)) {
      if (!attachmentType(file) || file.size < 1 || file.size > COMMENT_ATTACHMENT_MAX_BYTES) {
        setAttachmentError(`${file.name} 不是受支持的图片或超过 25 MiB`);
        continue;
      }
      accepted.push({ id: crypto.randomUUID(), file, state: "queued", progress: 0 });
    }
    setPendingAttachments((current) => [...current, ...accepted]);
  }

  function removeAttachment(id: string): void {
    setPendingAttachments((current) => current.filter((item) => item.id !== id));
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
          <div className="flex items-start gap-3"><UserAvatar name={comment.authorDisplayName || comment.authorUsername} size="sm" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"><strong>{comment.authorDisplayName || comment.authorUsername}</strong><span className="text-muted-foreground">@{comment.authorUsername}</span><time className="text-muted-foreground" dateTime={comment.createdAt}>{relativeDate(comment.createdAt)}</time></div><p className={comment.deleted ? "mt-2 text-sm italic text-muted-foreground" : "mt-2 whitespace-pre-wrap text-sm leading-6"}>{comment.deleted ? "该评论已删除" : comment.body}</p>{comment.attachments?.length && !comment.deleted ? <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{comment.attachments.map((attachment) => attachment.downloadUrl ? <a key={attachment.id} href={attachment.downloadUrl} target="_blank" rel="noreferrer" className="group overflow-hidden rounded-md border bg-muted/20" title={`查看 ${attachment.filename}`}><img src={attachment.downloadUrl} alt={attachment.filename} loading="lazy" className="aspect-square w-full object-cover transition-transform group-hover:scale-[1.02]" /></a> : <span key={attachment.id} className="grid aspect-square place-items-center rounded-md border bg-muted/20 p-2 text-center text-[11px] text-muted-foreground"><FileImage size={16} /><span className="mt-1 break-all">{attachment.filename}<br />暂时无法读取</span></span>)}</div> : null}<div className="mt-3 flex flex-wrap items-center gap-2"><Button size="sm" variant="ghost" onClick={() => { setReplyTo(comment); setSubmitState("idle"); setSubmitError(""); }}><Reply size={13} />回复</Button>{comment.canDelete && !comment.deleted ? <Button size="sm" variant="ghost" className="text-destructive" onClick={() => void remove(comment)} disabled={deletingId === comment.id}>{deletingId === comment.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}删除</Button> : null}</div></div></div>
        </article>;
      })}</div> : null}
      {deleteError ? <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="alert">{deleteError}</p> : null}

      <form className="mt-6 rounded-md border bg-muted/20 p-4" onSubmit={(event) => void submit(event)}>
        {anchor ? <div className="mb-3 flex items-start justify-between gap-3 border-l-2 border-foreground pl-3 text-xs text-muted-foreground"><span><strong className="text-foreground">评论此段</strong><br />{anchor.label}：{anchor.quote}</span><Button type="button" size="icon" variant="ghost" aria-label="取消段落引用" title="取消段落引用" onClick={() => setAnchor(null)}><X size={14} /></Button></div> : null}
        {replyTo ? <div className="mb-3 flex items-center justify-between gap-2 border-l-2 border-foreground pl-3 text-xs text-muted-foreground"><span className="flex items-center gap-1"><CornerDownRight size={13} />回复 @{replyTo.authorUsername}</span><Button type="button" size="icon" variant="ghost" aria-label="取消回复" title="取消回复" onClick={() => setReplyTo(null)}><X size={14} /></Button></div> : null}
        {pendingAttachments.length ? <div className="mb-3 grid gap-2" aria-live="polite">{pendingAttachments.map((attachment) => <div key={attachment.id} className="flex items-center gap-2 rounded-md border bg-background px-2.5 py-2 text-xs"><FileImage size={15} className="shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate" title={attachment.file.name}>{attachment.file.name}</span>{attachment.state === "uploading" ? <span className="flex shrink-0 items-center gap-1 text-muted-foreground"><Loader2 size={13} className="animate-spin" />{attachment.progress}%</span> : attachment.state === "ready" ? <span className="flex shrink-0 items-center gap-1 text-foreground"><CheckCircle2 size={13} />已校验</span> : attachment.state === "failed" ? <span className="flex shrink-0 items-center gap-1 text-destructive" title={attachment.error}><AlertCircle size={13} />失败</span> : <span className="text-muted-foreground">待上传</span>}<Button type="button" size="icon" variant="ghost" aria-label={`移除 ${attachment.file.name}`} title="移除附件" onClick={() => removeAttachment(attachment.id)} disabled={attachment.state === "uploading"}><X size={14} /></Button></div>)}</div> : null}
        <textarea value={body} onChange={(event) => { setBody(event.target.value); if (submitState !== "idle") setSubmitState("idle"); }} placeholder={authenticated ? "写下你的看法…" : "登录后参与讨论"} rows={3} maxLength={10000} disabled={submitState === "saving"} className="min-h-24 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring" aria-label="评论内容" />
        {attachmentError ? <p className="mt-2 flex items-center gap-1.5 text-xs text-destructive" role="alert"><AlertCircle size={14} />{attachmentError}</p> : null}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><span className="text-xs text-muted-foreground">{body.length}/10000 · {authenticated ? "评论会显示你的真实用户资料" : "匿名仅可阅读"}</span><div className="flex items-center gap-2"><input ref={attachmentInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple className="sr-only" onChange={(event) => { selectAttachments(event.target.files); event.currentTarget.value = ""; }} /><Button type="button" size="sm" variant="outline" onClick={() => { if (!authenticated) { onRequireLogin(); return; } attachmentInputRef.current?.click(); }} disabled={submitState === "saving" || pendingAttachments.length >= COMMENT_ATTACHMENT_MAX}><UploadCloud size={14} />添加图片/GIF</Button><Button type="submit" size="sm" disabled={!body.trim() || submitState === "saving"}>{submitState === "saving" ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}发布评论</Button></div></div>
        {submitState === "success" ? <p className="mt-2 text-xs text-foreground" role="status">评论已发布。</p> : null}
        {submitState === "error" ? <div className="mt-2 flex items-center justify-between gap-3 text-xs text-destructive" role="alert"><span>{submitError}</span><Button type="button" size="sm" variant="ghost" onClick={() => setSubmitState("idle")}>重试</Button></div> : null}
      </form>
    </section>
  );
}
