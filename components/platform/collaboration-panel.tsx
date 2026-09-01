"use client";

import { Check, GitPullRequest, Loader2, MessageSquare, RefreshCw, ShieldAlert, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import type { MergeRequestSummary, ReviewSummary, CollaborationDiffEntry } from "@/lib/domain/collaboration";

interface CollaborationPanelProps {
  projectId: string;
  authenticated: boolean;
  canReview: boolean;
  onRequireLogin: () => void;
  refreshToken?: number;
}

interface ListResponse { mergeRequests?: MergeRequestSummary[]; error?: string; }
interface DetailResponse { mergeRequest?: MergeRequestSummary; reviews?: ReviewSummary[]; diff?: { entries: CollaborationDiffEntry[] }; error?: string; }

const statusCopy: Record<MergeRequestSummary["status"], string> = { draft: "草稿", open: "待审核", changes_requested: "需修改", approved: "已批准", merged: "已合并", closed: "已关闭" };

/** 项目修改申请面板：匿名仅读公开申请，审核与合并按钮必须通过真实会话和服务端授权。 */
export function CollaborationPanel({ projectId, authenticated, canReview, onRequireLogin, refreshToken = 0 }: CollaborationPanelProps) {
  const [requests, setRequests] = useState<MergeRequestSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const loadRequests = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/platform/changes?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" });
      const payload = await response.json() as ListResponse;
      if (!response.ok) throw new Error(payload.error ?? "修改申请暂时无法加载");
      setRequests(payload.mergeRequests ?? []);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "修改申请暂时无法加载"); }
    finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { void loadRequests(); }, [loadRequests, refreshToken]);

  async function selectRequest(id: string) {
    setSelectedId(id); setDetail(null); setDetailLoading(true); setError("");
    if (!authenticated) { setError("登录后才能查看修改申请的 Diff 和审核记录；公开内容仍可匿名阅读。"); setDetailLoading(false); return; }
    try {
      const response = await fetch(`/api/platform/changes/${encodeURIComponent(id)}?diff=1`, { cache: "no-store" });
      const payload = await response.json() as DetailResponse;
      if (!response.ok) throw new Error(payload.error ?? "修改申请详情加载失败");
      setDetail(payload);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "修改申请详情加载失败"); }
    finally { setDetailLoading(false); }
  }

  async function review(verdict: "approve" | "request_changes" | "reject") {
    if (!selectedId) return;
    if (!authenticated) { onRequireLogin(); return; }
    setPending(true); setError("");
    try {
      const response = await fetch(`/api/platform/changes/${encodeURIComponent(selectedId)}/review`, { method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ verdict }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "审核提交失败");
      await selectRequest(selectedId); await loadRequests();
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "审核提交失败"); }
    finally { setPending(false); }
  }

  async function merge() {
    if (!selectedId) return;
    if (!authenticated) { onRequireLogin(); return; }
    setPending(true); setError("");
    try {
      const response = await fetch(`/api/platform/changes/${encodeURIComponent(selectedId)}/merge`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "合并失败，请重新检查 Diff");
      await selectRequest(selectedId); await loadRequests();
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "合并失败，请重新检查 Diff"); }
    finally { setPending(false); }
  }

  const changedEntries = (detail?.diff?.entries ?? []).filter((entry) => entry.operation !== "unchanged");

  return (
    <section className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,380px)]" aria-label="修改申请">
      <div className="rounded-lg border bg-background">
        <div className="flex items-center justify-between border-b px-4 py-3"><div className="flex items-center gap-2 text-sm font-semibold"><GitPullRequest size={16} />修改申请</div><Button size="icon" variant="ghost" onClick={() => void loadRequests()} disabled={loading} aria-label="刷新修改申请"><RefreshCw size={15} className={loading ? "animate-spin" : undefined} /></Button></div>
        {error && !selectedId ? <p className="m-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800" role="alert">{error}</p> : null}
        {loading ? <div className="flex items-center gap-2 p-6 text-xs text-muted-foreground"><Loader2 size={15} className="animate-spin" />加载申请…</div> : null}
        {!loading && requests.length === 0 ? <p className="p-6 text-xs text-muted-foreground">当前没有公开修改申请。</p> : null}
        <div className="divide-y">{requests.map((request) => <button key={request.id} type="button" className={`block w-full px-4 py-3 text-left transition-colors hover:bg-muted/50 ${selectedId === request.id ? "bg-muted" : ""}`} onClick={() => void selectRequest(request.id)}><div className="flex items-start justify-between gap-3"><span className="min-w-0 truncate text-sm font-medium">{request.title}</span><span className="shrink-0 rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground">{statusCopy[request.status]}</span></div><span className="mt-1 block text-[11px] text-muted-foreground">#{request.id.slice(0, 8)} · {request.sourceBranchId} → {request.targetBranchId}</span></button>)}</div>
      </div>

      <div className="rounded-lg border bg-background">
        <div className="border-b px-4 py-3 text-sm font-semibold">审核与 Diff</div>
        {!selectedId ? <div className="grid min-h-40 place-items-center p-5 text-center text-xs text-muted-foreground"><MessageSquare size={18} /><span>选择一个修改申请查看详情</span></div> : null}
        {detailLoading ? <div className="flex items-center gap-2 p-6 text-xs text-muted-foreground"><Loader2 size={15} className="animate-spin" />加载详情…</div> : null}
        {selectedId && !detailLoading && detail ? <div className="space-y-4 p-4"><div><h3 className="m-0 text-sm font-semibold">{detail.mergeRequest?.title}</h3><p className="mt-1 text-[11px] text-muted-foreground">状态：{detail.mergeRequest ? statusCopy[detail.mergeRequest.status] : "未知"} · {changedEntries.length} 个文件变化</p></div><div className="max-h-56 space-y-2 overflow-y-auto">{changedEntries.length ? changedEntries.map((entry) => <div key={entry.nodeId} className="rounded-md border p-2 text-[11px]"><div className="flex items-center gap-2"><span className={entry.operation === "conflict" ? "text-destructive" : "text-primary"}>{entry.operation}</span><code className="truncate">{entry.nodeId}</code></div>{entry.conflicts.map((conflict) => <p key={`${conflict.nodeId}-${conflict.reason}`} className="mt-1 text-destructive">冲突：{conflict.reason}，需要人工处理</p>)}</div>) : <p className="text-xs text-muted-foreground">没有可合并的变化。</p>}</div>{detail.reviews?.length ? <div className="space-y-1 border-t pt-3">{detail.reviews.map((reviewItem) => <p key={reviewItem.id} className="text-[11px] text-muted-foreground"><strong className="text-foreground">{reviewItem.reviewerUserId}</strong> · {statusCopy[reviewItem.verdict === "approve" ? "approved" : reviewItem.verdict === "request_changes" ? "changes_requested" : reviewItem.verdict === "reject" ? "closed" : "open"]}</p>)}</div> : null}{error ? <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800" role="alert">{error}</p> : null}{canReview && detail.mergeRequest?.status !== "merged" && detail.mergeRequest?.status !== "closed" ? <div className="flex flex-wrap gap-2 border-t pt-3"><Button size="sm" disabled={pending} onClick={() => void review("approve")}><Check size={14} />批准</Button><Button size="sm" variant="outline" disabled={pending} onClick={() => void review("request_changes")}><ShieldAlert size={14} />要求修改</Button><Button size="sm" variant="ghost" className="text-destructive" disabled={pending} onClick={() => void review("reject")}><X size={14} />拒绝</Button>{detail.mergeRequest?.status === "approved" ? <Button size="sm" variant="subtle" disabled={pending} onClick={() => void merge()}><GitPullRequest size={14} />合并</Button> : null}</div> : null}</div> : null}
        {selectedId && !detailLoading && !detail && error ? <p className="m-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800" role="alert">{error}</p> : null}
      </div>
    </section>
  );
}
