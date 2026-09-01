"use client";

import { AlertTriangle, CheckCircle2, ExternalLink, FileSearch, RefreshCw, Search, Send, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { AiConfigurationStatus, Report, SelectionContext, Source } from "./research-types";

interface ResearchAssistantProps {
  report: Report | undefined;
  selection: SelectionContext | null;
  sources: Source[];
  ai: AiConfigurationStatus | null;
  onClearSelection: () => void;
}

interface AssistantResponse {
  status: "degraded" | "context_ready";
  reason: string;
  answer: string | null;
  context: {
    mode: "selection" | "retrieval";
    refusalReason: string | null;
    evidence: Array<{ chunkId: string; sourceId: string; title: string; url: string | null; page: number | null; quote: string }>;
  };
}

type AssistantState = "idle" | "thinking" | "ready" | "error";

/** 右侧助手只调用受限上下文 API；未配置模型时展示降级事实，不伪造模型回答。 */
export function ResearchAssistant({ report, selection, sources, ai, onClearSelection }: ResearchAssistantProps) {
  const [question, setQuestion] = useState("");
  const [state, setState] = useState<AssistantState>("idle");
  const [result, setResult] = useState<AssistantResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!selection) return;
    const verbs: Record<SelectionContext["action"], string> = { ask: "基于选中段落回答：", explain: "解释这段文字的业务含义：", sources: "为这段文字补充应检索的来源：", rewrite: "在不改变事实边界的前提下改写：" };
    setQuestion(`${verbs[selection.action]}${selection.text}`);
    setState("idle");
    setResult(null);
  }, [selection]);

  async function submitQuestion(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!question.trim() || state === "thinking" || !report) return;
    setState("thinking");
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/research/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reportId: report.id, question: question.trim(), selectedText: selection?.text, selectedSectionId: selection?.sectionId }),
      });
      const payload = await response.json() as AssistantResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "AI 请求失败，请稍后重试。");
      setResult(payload);
      setState("ready");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "AI 请求失败，请稍后重试。");
      setState("error");
    }
  }

  const modelCopy = ai?.model.configured ? `${ai.model.provider} · ${ai.model.model}` : "模型未配置";

  return (
    <aside className="assistant-pane" aria-label="证据型 AI 助手">
      <div className="assistant-heading"><div><span className="assistant-eyebrow"><Sparkles size={14} aria-hidden="true" />AI 研究助手</span><h2>有证据地推进下一步</h2></div><span className={ai?.model.configured ? "model-state model-state--ready" : "model-state"}><span className={ai?.model.configured ? "status-dot status-dot--success" : "status-dot status-dot--neutral"} />{modelCopy}</span></div>

      {selection ? <div className="selection-context"><div><span>当前选区</span><p>“{selection.text.length > 74 ? `${selection.text.slice(0, 74)}…` : selection.text}”</p></div><button type="button" aria-label="清除当前选区" title="清除当前选区" onClick={onClearSelection}><X size={15} aria-hidden="true" /></button></div> : null}

      <div className="assistant-thread" aria-live="polite" aria-busy={state === "thinking"}>
        {state === "idle" ? <div className="assistant-idle"><FileSearch size={24} aria-hidden="true" /><p>{report ? "先选择一段文字，或提出一个与当前报告有关的问题。" : "先从左侧选择一份报告，再发起有证据的提问。"}</p>{report ? <button type="button" onClick={() => setQuestion("梳理当前报告中已证实事实与待核验结论")}>梳理证据边界</button> : null}</div> : null}
        {state === "thinking" ? <div className="assistant-progress"><span className="typing-dots" aria-hidden="true"><i /><i /><i /></span><div><strong>正在准备受限上下文</strong><p>只会读取当前报告、当前选区和已导入的 active 来源。</p></div></div> : null}
        {state === "error" ? <div className="assistant-error"><AlertTriangle size={18} aria-hidden="true" /><div><strong>请求未完成</strong><p>{error}</p><button type="button" onClick={() => setState("idle")}><RefreshCw size={14} aria-hidden="true" />重新编辑</button></div></div> : null}
        {state === "ready" && result ? <div className={result.status === "degraded" ? "assistant-error" : "assistant-result"}><AlertTriangle size={18} aria-hidden="true" /><div><strong>{result.status === "degraded" ? "模型未配置，已降级" : "已生成可审查上下文"}</strong><p>{result.reason}</p>{result.context.refusalReason ? <p className="assistant-result-warning">{result.context.refusalReason}</p> : null}{result.answer ? <p>{result.answer}</p> : null}{result.context.evidence.length ? <div className="assistant-evidence-list">{result.context.evidence.slice(0, 4).map((evidence) => <a href={evidence.url ?? "#"} key={evidence.chunkId} target={evidence.url ? "_blank" : undefined} rel={evidence.url ? "noreferrer" : undefined}><span>{evidence.title}{evidence.page ? ` · 第 ${evidence.page} 页` : ""}</span><small>{evidence.quote}</small></a>)}</div> : null}</div></div> : null}
      </div>

      <section className="evidence-panel" aria-label="当前报告的来源">
        <div className="panel-heading"><span>当前来源</span><span className="mono">{sources.length} 条</span></div>
        {sources.length === 0 ? <p className="evidence-empty">尚未导入来源，助手会在证据不足时拒答。</p> : null}
        {sources.slice(0, 3).map((source) => <a className="evidence-row" href={source.url ?? "#"} key={source.id} target={source.url ? "_blank" : undefined} rel={source.url ? "noreferrer" : undefined}><div className="source-id"><CheckCircle2 size={14} aria-hidden="true" />{source.id}</div><strong>{source.title}</strong><span>{source.kind} · {new Date(source.capturedAt).toLocaleDateString("zh-CN")}</span><p>{source.snapshot.slice(0, 92)}{source.snapshot.length > 92 ? "…" : ""}</p>{source.url ? <ExternalLink size={13} aria-hidden="true" /> : null}</a>)}
      </section>

      <form className="assistant-composer" onSubmit={submitQuestion}>
        <label htmlFor="assistant-question">向当前报告提问</label>
        <div className="composer-shell"><textarea id="assistant-question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="例如：这条竞争判断缺少哪些证据？" rows={3} disabled={!report} /><button type="submit" aria-label="发送问题" title="发送问题" disabled={!question.trim() || state === "thinking" || !report}><Send size={16} aria-hidden="true" /></button></div>
        <p><Search size={13} aria-hidden="true" />仅使用当前报告与已导入来源 · <kbd>⌘↵</kbd> 发送</p>
      </form>
    </aside>
  );
}
