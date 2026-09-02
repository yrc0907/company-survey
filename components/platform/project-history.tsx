"use client";

import { AlertCircle, GitCommitHorizontal, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/ui/avatar";

interface HistoryCommit { id: string; message: string; author: { id: string; username: string; displayName: string }; createdAt: string; changedFiles: number; }

/** GitHub 风格的公开版本时间线；每一项都来自数据库 Commit，不显示客户端伪造活动。 */
export function ProjectHistory({ projectId }: { projectId: string }) {
  const [commits, setCommits] = useState<HistoryCommit[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setState("loading"); setError("");
    try {
      const response = await fetch(`/api/platform/projects/${encodeURIComponent(projectId)}/history?limit=100`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({})) as { commits?: HistoryCommit[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "版本历史暂时无法读取");
      setCommits(Array.isArray(payload.commits) ? payload.commits : []); setState("ready");
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "版本历史暂时无法读取"); setState("error"); }
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);
  return <section className="mx-auto w-full max-w-[860px] px-5 pb-20 pt-8 sm:px-14" aria-labelledby="project-history-title"><div className="flex items-start justify-between gap-3 border-b pb-6"><div><p className="mb-1 text-xs text-muted-foreground">公开主分支 · main</p><h1 id="project-history-title" className="m-0 flex items-center gap-2 text-2xl font-semibold"><GitCommitHorizontal size={21} />版本历史</h1><p className="mb-0 mt-2 text-sm text-muted-foreground">只读展示已合并或公开提交的 Commit 元数据；草稿正文不会出现在这里。</p></div><Button size="icon" variant="ghost" onClick={() => void load()} disabled={state === "loading"} aria-label="刷新版本历史"><RefreshCw size={15} className={state === "loading" ? "animate-spin" : undefined} /></Button></div>{state === "loading" ? <div className="flex items-center gap-2 py-20 text-sm text-muted-foreground" role="status" aria-busy="true"><Loader2 size={16} className="animate-spin" />正在读取版本历史…</div> : null}{state === "error" ? <div className="mt-6 flex items-center gap-2 rounded-lg border border-red-500/30 p-4 text-sm" role="alert"><AlertCircle size={16} />{error}<Button size="sm" variant="outline" onClick={() => void load()}>重试</Button></div> : null}{state === "ready" && commits.length === 0 ? <div className="py-20 text-center text-sm text-muted-foreground">当前项目还没有公开 Commit。</div> : null}{state === "ready" && commits.length > 0 ? <ol className="mt-6 divide-y rounded-lg border">{commits.map((commit) => <li key={commit.id} className="flex items-center gap-3 px-4 py-4"><UserAvatar name={commit.author.displayName} size="sm" /><div className="min-w-0 flex-1"><p className="m-0 truncate text-sm font-medium">{commit.message}</p><p className="mb-0 mt-1 text-xs text-muted-foreground"><a className="hover:underline" href={`/u/${encodeURIComponent(commit.author.username)}`}>{commit.author.displayName}</a> · {new Date(commit.createdAt).toLocaleString("zh-CN")} · {commit.changedFiles} 个文件变化</p></div><code className="hidden shrink-0 text-[10px] text-muted-foreground sm:block">{commit.id.slice(0, 8)}</code></li>)}</ol> : null}</section>;
}
