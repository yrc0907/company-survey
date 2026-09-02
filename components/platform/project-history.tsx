"use client";

import { AlertCircle, ChevronDown, GitCommitHorizontal, Loader2, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/ui/avatar";

interface HistoryCommit { id: string; message: string; author: { id: string; username: string; displayName: string }; createdAt: string; changedFiles: number; }
interface DiffHunk { type: "equal" | "add" | "remove"; value: string; }
interface DiffSide { revisionId: string | null; name: string | null; parentNodeId: string | null; contentText: string; contentHash: string | null; truncated: boolean; }
interface HistoryChange { id: string; nodeId: string; operation: string; currentName: string | null; before: DiffSide | null; after: DiffSide | null; hunks: DiffHunk[]; mergeRequestId: string | null; }
interface HistoryDetail { projectId: string; commit: { id: string; parentCommitId: string | null; message: string; aiAssisted: boolean; author: { id: string; username: string; displayName: string }; createdAt: string }; changes: HistoryChange[]; source: string; }

const operationLabel: Record<string, string> = { create_node: "新增文件", update_content: "修改正文", rename_node: "重命名", move_node: "移动位置", delete_node: "删除文件", restore_node: "恢复文件", duplicate_node: "复制文件" };

/** GitHub 风格的公开版本时间线；每项来自数据库 Commit，不显示客户端伪造活动。 */
export function ProjectHistory({ projectId }: { projectId: string }) {
  const [commits, setCommits] = useState<HistoryCommit[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [selectedCommitId, setSelectedCommitId] = useState<string | null>(null);
  const [detail, setDetail] = useState<HistoryDetail | null>(null);
  const [detailState, setDetailState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [detailError, setDetailError] = useState("");
  const [reverting, setReverting] = useState(false);

  const load = useCallback(async () => {
    setState("loading"); setError("");
    try {
      const response = await fetch(`/api/platform/projects/${encodeURIComponent(projectId)}/history?limit=100`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({})) as { commits?: HistoryCommit[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "版本历史暂时无法读取");
      setCommits(Array.isArray(payload.commits) ? payload.commits : []); setState("ready");
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "版本历史暂时无法读取"); setState("error"); }
  }, [projectId]);

  const openDetail = useCallback(async (commitId: string) => {
    if (selectedCommitId === commitId && detailState === "ready") return;
    setSelectedCommitId(commitId); setDetail(null); setDetailState("loading"); setDetailError("");
    try {
      const response = await fetch(`/api/platform/projects/${encodeURIComponent(projectId)}/history/${encodeURIComponent(commitId)}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({})) as HistoryDetail & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "版本 Diff 暂时无法读取");
      setDetail(payload); setDetailState("ready");
    } catch (requestError) { setDetailError(requestError instanceof Error ? requestError.message : "版本 Diff 暂时无法读取"); setDetailState("error"); }
  }, [detailState, projectId, selectedCommitId]);

  /** 回滚只能由项目维护者执行且只针对当前 HEAD；服务端会追加反向 Commit。 */
  async function revertCommit(): Promise<void> {
    if (!selectedCommitId || reverting) return;
    setReverting(true); setDetailError("");
    try {
      const response = await fetch(`/api/platform/projects/${encodeURIComponent(projectId)}/history/${encodeURIComponent(selectedCommitId)}/revert`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: "{}" });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "回滚失败");
      setDetail(null); setSelectedCommitId(null); setDetailState("idle"); setError("");
      await load();
    } catch (requestError) { setDetailError(requestError instanceof Error ? requestError.message : "回滚失败"); }
    finally { setReverting(false); }
  }

  useEffect(() => { void load(); }, [load]);

  return <section className="mx-auto w-full max-w-[860px] px-5 pb-20 pt-8 sm:px-14" aria-labelledby="project-history-title">
    <div className="flex items-start justify-between gap-3 border-b pb-6"><div><p className="mb-1 text-xs text-muted-foreground">公开主分支 · main</p><h1 id="project-history-title" className="m-0 flex items-center gap-2 text-2xl font-semibold"><GitCommitHorizontal size={21} />版本历史</h1><p className="mb-0 mt-2 text-sm text-muted-foreground">只读展示已合并或公开提交；点击 Commit 可查看逐文件、逐行 Diff。草稿正文不会出现在这里。</p></div><Button size="icon" variant="ghost" onClick={() => void load()} disabled={state === "loading"} aria-label="刷新版本历史"><RefreshCw size={15} className={state === "loading" ? "animate-spin" : undefined} /></Button></div>
    {state === "loading" ? <div className="flex items-center gap-2 py-20 text-sm text-muted-foreground" role="status" aria-busy="true"><Loader2 size={16} className="animate-spin" />正在读取版本历史…</div> : null}
    {state === "error" ? <div className="mt-6 flex items-center gap-2 rounded-lg border border-red-500/30 p-4 text-sm" role="alert"><AlertCircle size={16} />{error}<Button size="sm" variant="outline" onClick={() => void load()}>重试</Button></div> : null}
    {state === "ready" && commits.length === 0 ? <div className="py-20 text-center text-sm text-muted-foreground">当前项目还没有公开 Commit。</div> : null}
    {state === "ready" && commits.length > 0 ? <ol className="mt-6 divide-y rounded-lg border">{commits.map((commit) => <li key={commit.id} className="flex items-center gap-3 px-4 py-4"><UserAvatar name={commit.author.displayName} size="sm" /><div className="min-w-0 flex-1"><button type="button" className="max-w-full truncate text-left text-sm font-medium hover:underline" onClick={() => void openDetail(commit.id)} aria-expanded={selectedCommitId === commit.id}>{commit.message}</button><p className="mb-0 mt-1 truncate text-xs text-muted-foreground"><a className="hover:underline" href={`/u/${encodeURIComponent(commit.author.username)}`}>{commit.author.displayName}</a> · {new Date(commit.createdAt).toLocaleString("zh-CN")} · {commit.changedFiles} 个文件变化</p></div><button type="button" className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted" onClick={() => void openDetail(commit.id)} aria-label={`查看 ${commit.message} 的逐文件 Diff`} title="查看 Diff"><ChevronDown size={16} className={selectedCommitId === commit.id ? "rotate-180 transition-transform" : "transition-transform"} /></button><code className="hidden shrink-0 text-[10px] text-muted-foreground sm:block">{commit.id.slice(0, 8)}</code></li>)}</ol> : null}
    {selectedCommitId ? <section className="mt-6 rounded-lg border bg-muted/20 p-4" aria-labelledby="commit-diff-title" aria-live="polite"><div className="flex items-start justify-between gap-3 border-b pb-3"><div><p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">公开 Commit Diff</p><h2 id="commit-diff-title" className="m-0 text-base font-semibold">{detail?.commit.message ?? "正在读取版本…"}</h2>{detail?.commit ? <p className="mb-0 mt-1 text-xs text-muted-foreground">{detail.commit.author.displayName} · {new Date(detail.commit.createdAt).toLocaleString("zh-CN")}{detail.commit.parentCommitId ? ` · parent ${detail.commit.parentCommitId.slice(0, 8)}` : " · 初始版本"}</p> : null}</div><div className="flex items-center gap-1"><Button size="sm" variant="outline" onClick={() => void revertCommit()} disabled={reverting || detailState !== "ready"} title="仅项目维护者可回滚当前公开 HEAD">{reverting ? <Loader2 size={13} className="animate-spin" /> : null}{reverting ? "回滚中…" : "回滚此版本"}</Button><Button size="icon" variant="ghost" onClick={() => { setSelectedCommitId(null); setDetail(null); setDetailState("idle"); }} aria-label="关闭 Diff"><X size={15} /></Button></div></div>
      {detailState === "loading" ? <div className="flex items-center gap-2 py-8 text-xs text-muted-foreground" role="status"><Loader2 size={14} className="animate-spin" />正在计算逐文件 Diff…</div> : null}
      {detailState === "error" ? <div className="mt-4 flex items-center gap-2 rounded-md border border-red-500/30 p-3 text-xs" role="alert"><AlertCircle size={14} />{detailError}<Button size="sm" variant="outline" onClick={() => void openDetail(selectedCommitId)}>重试</Button></div> : null}
      {detailState === "ready" && detail?.changes.length === 0 ? <p className="mb-0 py-8 text-center text-xs text-muted-foreground">该 Commit 没有可公开展示的文件变化。</p> : null}
      {detailState === "ready" && detail ? <div className="mt-4 grid gap-4">{detail.changes.map((change) => <article key={change.id} className="overflow-hidden rounded-md border bg-background"><header className="flex flex-wrap items-center gap-2 border-b px-3 py-2 text-xs"><strong>{change.currentName ?? change.after?.name ?? change.before?.name ?? change.nodeId}</strong><span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">{operationLabel[change.operation] ?? change.operation}</span>{change.mergeRequestId ? <span className="text-muted-foreground">MR {change.mergeRequestId.slice(0, 8)}</span> : null}</header><div className="overflow-x-auto p-3 font-mono text-[11px] leading-5">{change.hunks.length ? change.hunks.map((hunk, index) => <div key={`${hunk.type}-${index}`} className={hunk.type === "add" ? "whitespace-pre-wrap bg-emerald-500/10 text-emerald-800 dark:text-emerald-300" : hunk.type === "remove" ? "whitespace-pre-wrap bg-red-500/10 text-red-800 dark:text-red-300" : "whitespace-pre-wrap text-muted-foreground"}><span className="mr-2 inline-block w-3 select-none text-center opacity-60">{hunk.type === "add" ? "+" : hunk.type === "remove" ? "−" : " "}</span>{hunk.value}</div>) : <span className="text-muted-foreground">仅树结构元数据变化，正文没有可比较文本。</span>}</div>{(change.before?.truncated || change.after?.truncated) ? <p className="mb-0 border-t px-3 py-2 text-[10px] text-amber-700">Diff 为安全长度投影，原始正文未被公开接口返回。</p> : null}</article>)}</div> : null}
    </section> : null}
  </section>;
}
