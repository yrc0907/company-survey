"use client";

import { Archive, ChevronDown, Clock3, FileText, History, Loader2, MessageSquarePlus, Search, Send, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { SeedProject } from "@/lib/ui/platform-seed";

type AssistantScope = "current_file" | "current_project" | "all_public";
type AssistantState = "idle" | "loading" | "ready" | "error";

interface AssistantMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: number;
}

interface AssistantApiResponse {
  status: "context_ready" | "degraded";
  reason: string;
  answer?: string;
  context?: { evidence?: unknown[] };
}

const scopeLabels: Record<AssistantScope, string> = {
  current_file: "当前文件",
  current_project: "当前项目",
  all_public: "全站公开知识",
};

interface AssistantPanelProps {
  project: SeedProject;
  activeFileName: string;
}

/** AI 助手只调用既有受限报告接口；无对应报告时明确拒绝，不生成伪回答。 */
export function AssistantPanel({ project, activeFileName }: AssistantPanelProps) {
  const [scope, setScope] = useState<AssistantScope>("current_project");
  const [question, setQuestion] = useState("");
  const [state, setState] = useState<AssistantState>("idle");
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [error, setError] = useState("");
  const [historySearch, setHistorySearch] = useState("");

  const conversationTitle = messages.find((message) => message.role === "user")?.content.slice(0, 20) || "新对话";
  const historyItems = useMemo(() => messages.length ? [{ id: "current", title: conversationTitle, meta: `${project.title} · 刚刚` }] : [], [conversationTitle, messages.length, project.title]);
  const visibleHistory = historyItems.filter((item) => item.title.toLocaleLowerCase("zh-CN").includes(historySearch.trim().toLocaleLowerCase("zh-CN")));

  async function sendQuestion(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || state === "loading") return;
    if (!project.assistantReportId) {
      setError("这个 Seed 项目尚未关联可检索报告，AI 不会伪造回答。请先打开“慧策”项目体验真实受限问答。");
      setState("error");
      return;
    }
    if (scope === "all_public") {
      setError("全站公开检索尚未接入持久化索引；当前版本不会把项目级检索伪装成全站检索。");
      setState("error");
      return;
    }

    const userMessage: AssistantMessage = { id: `user-${Date.now()}`, role: "user", content: trimmed };
    setMessages((current) => [...current, userMessage]);
    setQuestion("");
    setError("");
    setState("loading");
    try {
      const response = await fetch("/api/research/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reportId: project.assistantReportId, question: trimmed }),
      });
      const payload = await response.json() as AssistantApiResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "AI 请求失败，请稍后重试。");
      setMessages((current) => [...current, {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: payload.answer || payload.reason,
        citations: payload.context?.evidence?.length ?? 0,
      }]);
      setState("ready");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "AI 请求失败，请稍后重试。");
      setState("error");
    }
  }

  function newConversation() {
    setMessages([]);
    setQuestion("");
    setError("");
    setState("idle");
  }

  return (
    <aside className="project-assistant" aria-label="AI 研究助手">
      <header className="assistant-header">
        <div className="assistant-title"><span><Sparkles size={15} />AI 助手</span><small>匿名体验 · 项目证据优先</small></div>
        <div className="assistant-header-actions">
          <Button size="icon" variant="ghost" aria-label="新对话" title="新对话" onClick={newConversation}><MessageSquarePlus size={16} /></Button>
          <Sheet>
            <SheetTrigger asChild><Button size="icon" variant="ghost" aria-label="历史对话" title="历史对话"><History size={16} /></Button></SheetTrigger>
            <SheetContent>
              <div className="sheet-heading"><SheetTitle>历史对话</SheetTitle><SheetDescription>游客对话仅保留在当前浏览器会话；登录后的持久化与搜索尚未接入。</SheetDescription></div>
              <label className="history-search"><Search size={15} /><input value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} placeholder="搜索标题或消息" /></label>
              <div className="history-list">
                {visibleHistory.map((item) => <button key={item.id} type="button"><MessageSquarePlus size={16} /><span><strong>{item.title}</strong><small>{item.meta}</small></span><Archive size={14} /></button>)}
                {visibleHistory.length === 0 ? <div className="history-empty"><Clock3 size={20} /><p>当前还没有可搜索的历史对话。</p></div> : null}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </header>

      <div className="assistant-context-bar">
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="subtle" size="sm"><FileText size={14} />范围：{scopeLabels[scope]}<ChevronDown size={13} /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel>本轮读取范围</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={scope} onValueChange={(value) => setScope(value as AssistantScope)}>
              <DropdownMenuRadioItem value="current_file">当前文件 · {activeFileName}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="current_project">当前项目 · 按需检索</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="all_public">全站公开知识 · 尚未接入</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <p className="menu-help">私人草稿、其他用户对话和越权项目不会进入上下文。</p>
          </DropdownMenuContent>
        </DropdownMenu>
        <span>main@v{project.version}</span>
      </div>

      <div className="assistant-messages" aria-live="polite" aria-busy={state === "loading"}>
        {messages.length === 0 && state !== "error" ? <div className="assistant-welcome"><span><Sparkles size={19} /></span><h3>从证据开始提问</h3><p>回答只使用当前 Scope 内可访问的资料。AI 生成的修改只能加入草稿，不能直接发布。</p><div><button type="button" onClick={() => setQuestion("这份报告的关键结论和证据边界是什么？")}>梳理结论与边界</button><button type="button" onClick={() => setQuestion("哪些判断仍然缺少独立来源？")}>查找证据缺口</button></div></div> : null}
        {messages.map((message) => <article key={message.id} className={`assistant-message assistant-message--${message.role}`}><span>{message.role === "user" ? "你" : "AI"}</span><div><p>{message.content}</p>{message.citations !== undefined ? <small>{message.citations} 条上下文证据 · 可审查</small> : null}</div></article>)}
        {state === "loading" ? <div className="assistant-stage"><Loader2 className="animate-spin" size={16} /><span><strong>检索并重排证据</strong><small>只读取当前项目的 active 来源</small></span></div> : null}
        {error ? <div className="assistant-inline-error" role="alert">{error}</div> : null}
      </div>

      <form className="assistant-input" onSubmit={sendQuestion}>
        <textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder={`询问“${activeFileName}”或当前项目`} rows={3} />
        <div><span>{project.assistantReportId ? "匿名可用 · 不写入公开内容" : "当前 Seed 未接入检索"}</span><Button type="submit" size="icon" disabled={!question.trim() || state === "loading"} aria-label="发送问题"><Send size={16} /></Button></div>
      </form>
    </aside>
  );
}
