"use client";

import { CheckCircle2, CircleAlert, Loader2, Pause, Play, Plus, Square } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import type { KnowledgeTask, KnowledgeTaskEvent } from "@/lib/domain/agents";

interface TaskDetail { task: KnowledgeTask; events: KnowledgeTaskEvent[] }
interface KnowledgeTaskPanelProps { projectId: string; reportId: string; question: string; authenticated: boolean | null; onRequireLogin: () => void; }

/** 任务面板只消费 owner 过滤后的 API；它展示检查点和建议，不把 Agent 结果当成正式知识。 */
export function KnowledgeTaskPanel({ projectId, reportId, question, authenticated, onRequireLogin }: KnowledgeTaskPanelProps) {
  const [tasks, setTasks] = useState<KnowledgeTask[]>([]);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(false);

  const loadTasks = useCallback(async (): Promise<void> => {
    if (authenticated !== true) return;
    const response = await fetch(`/api/ai/tasks?reportId=${encodeURIComponent(reportId)}`, { cache: "no-store" });
    if (response.ok) setTasks((await response.json() as { tasks?: KnowledgeTask[] }).tasks ?? []);
  }, [authenticated, reportId]);
  useEffect(() => { void loadTasks(); }, [loadTasks]);

  async function createTask(): Promise<void> {
    if (authenticated !== true) { onRequireLogin(); return; }
    if (!question.trim()) return;
    setLoading(true);
    try {
      const response = await fetch("/api/ai/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reportId, projectId, scope: "current_project", question, execution: "queue" }) });
      if (response.ok) { const payload = await response.json() as { task?: KnowledgeTask }; if (payload.task) setTasks((current) => [payload.task!, ...current]); }
    } finally { setLoading(false); }
  }
  async function transition(id: string, action: "pause" | "resume" | "execute"): Promise<void> {
    setLoading(true);
    try { await fetch(`/api/ai/tasks/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) }); await loadTasks(); await openDetail(id); } finally { setLoading(false); }
  }
  async function openDetail(id: string): Promise<void> {
    const response = await fetch(`/api/ai/tasks/${encodeURIComponent(id)}`, { cache: "no-store" });
    if (response.ok) setDetail(await response.json() as TaskDetail);
  }
  const current = detail?.task;
  return <section className="mt-3 rounded-lg border bg-background p-3 text-xs" aria-label="知识任务">
    <div className="flex items-center justify-between gap-2"><strong>Knowledge Tasks</strong><Button size="sm" variant="outline" onClick={() => void createTask()} disabled={loading || !question.trim()}><Plus size={13} />后台任务</Button></div>
    {tasks.length === 0 ? <p className="mt-2 text-muted-foreground">把当前问题交给可恢复的 Agent 工作流。</p> : <div className="mt-2 grid gap-1">{tasks.slice(0, 4).map((task) => <button type="button" key={task.id} className="flex items-center justify-between gap-2 rounded border px-2 py-1.5 text-left hover:bg-muted" onClick={() => void openDetail(task.id)}><span className="min-w-0 truncate">{task.objective}</span><span className="shrink-0 text-[10px] text-muted-foreground">{task.status} · {task.currentNode}</span></button>)}</div>}
    {current ? <div className="mt-3 border-t pt-2"><div className="flex items-center gap-1"><StatusIcon status={current.status} /><strong>{current.status} / {current.currentNode}</strong></div><p className="mt-1 text-muted-foreground">Agent：{current.selectedAgents.join(" · ")} · Workflow：{current.workflowType ?? "research"}</p><div className="mt-2 flex flex-wrap gap-1">{current.status === "queued" ? <Button size="sm" variant="outline" onClick={() => void transition(current.id, "execute")} disabled={loading}><Play size={12} />执行</Button> : null}{current.status === "running" ? <Button size="sm" variant="outline" onClick={() => void transition(current.id, "pause")} disabled={loading}><Pause size={12} />请求暂停</Button> : null}{current.status === "paused" ? <Button size="sm" variant="outline" onClick={() => void transition(current.id, "resume")} disabled={loading}><Play size={12} />恢复</Button> : null}{current.status === "queued" || current.status === "paused" ? <Button size="sm" variant="ghost" onClick={() => void fetch(`/api/ai/tasks/${encodeURIComponent(current.id)}`, { method: "DELETE" }).then(loadTasks)} disabled={loading}><Square size={12} />取消</Button> : null}</div><p className="mt-2 text-[10px] text-muted-foreground">检查点：{current.checkpoint?.node ?? "尚未保存"} · 事件：{detail?.events.length ?? 0}</p>{current.result ? <p className="mt-1 rounded bg-muted p-2">证据片段：{Array.isArray((current.result.context as Record<string, unknown> | undefined)?.evidence) ? ((current.result.context as Record<string, unknown>).evidence as unknown[]).length : 0}；结果仍需人工确认。</p> : null}</div> : null}
  </section>;
}

function StatusIcon({ status }: { status: KnowledgeTask["status"] }) { return status === "completed" ? <CheckCircle2 size={13} className="text-emerald-600" /> : status === "failed" ? <CircleAlert size={13} className="text-amber-600" /> : status === "running" ? <Loader2 size={13} className="animate-spin text-primary" /> : <CircleAlert size={13} className="text-muted-foreground" />; }
