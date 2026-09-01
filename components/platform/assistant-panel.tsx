"use client";

import { Archive, ChevronDown, Clock3, FileText, History, Loader2, LogIn, MessageSquarePlus, Search, Send, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { Conversation, ConversationMessage } from "@/lib/domain/memory";
import type { SeedProject } from "@/lib/ui/platform-seed";

type AssistantScope = "current_file" | "current_project" | "all_public";
type AssistantState = "idle" | "loading" | "ready" | "error";
interface AssistantMessage { id: string; role: "user" | "assistant"; content: string; citations?: number; }
interface AssistantApiResponse { status: "context_ready" | "degraded"; reason: string; answer?: string; context?: { evidence?: unknown[] }; }
interface ConversationListItem { id: string; title: string; projectId: string | null; updatedAt: string; lastMessageAt: string | null; pinned: boolean; }

const scopeLabels: Record<AssistantScope, string> = { current_file: "当前文件", current_project: "当前项目", all_public: "全站公开知识" };
interface AssistantPanelProps { project: SeedProject; activeFileName: string; activeFileId?: string; }

function mapMessage(message: ConversationMessage): AssistantMessage | null {
  if (message.role !== "user" && message.role !== "assistant") return null;
  const citations = typeof message.metadata.citationCount === "number" ? message.metadata.citationCount : undefined;
  return { id: message.id, role: message.role, content: message.content, citations };
}
function mapConversation(item: Conversation): ConversationListItem { return { id: item.id, title: item.title, projectId: item.projectId, updatedAt: item.updatedAt, lastMessageAt: item.lastMessageAt, pinned: item.pinned }; }
function callbackToLogin(): void { const callback = `${window.location.pathname}${window.location.search}${window.location.hash}`; window.location.assign(`/login?intent=login&callbackUrl=${encodeURIComponent(callback)}`); }

/** AI 侧栏：游客调用受限只读问答；登录后通过 Conversation/Message API 保存原始对话并支持历史恢复。 */
export function AssistantPanel({ project, activeFileName, activeFileId }: AssistantPanelProps) {
  const [scope, setScope] = useState<AssistantScope>("current_project");
  const [question, setQuestion] = useState("");
  const [state, setState] = useState<AssistantState>("idle");
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [error, setError] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [history, setHistory] = useState<ConversationListItem[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/platform/account", { cache: "no-store" }).then(async (response) => {
      if (!active) return;
      const loggedIn = response.ok;
      setAuthenticated(loggedIn);
      if (!loggedIn) return;
      const historyResponse = await fetch(`/api/ai/conversations?projectId=${encodeURIComponent(project.id)}&status=active`, { cache: "no-store" });
      if (!active || !historyResponse.ok) return;
      const payload = await historyResponse.json() as { conversations?: Conversation[] };
      setHistory((payload.conversations ?? []).map(mapConversation));
    }).catch(() => { if (active) setAuthenticated(false); });
    return () => { active = false; };
  }, [project.id]);

  const conversationTitle = messages.find((message) => message.role === "user")?.content.slice(0, 60) || "新对话";
  const visibleHistory = useMemo(() => history.filter((item) => item.title.toLocaleLowerCase("zh-CN").includes(historySearch.trim().toLocaleLowerCase("zh-CN"))), [history, historySearch]);

  async function ensureConversation(): Promise<string> {
    if (conversationId) return conversationId;
    const response = await fetch("/api/ai/conversations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: conversationTitle, projectId: project.id }) });
    const payload = await response.json() as { conversation?: Conversation; error?: string };
    if (!response.ok || !payload.conversation) throw new Error(payload.error ?? "无法创建持久化对话");
    setConversationId(payload.conversation.id);
    setHistory((current) => [mapConversation(payload.conversation!), ...current.filter((item) => item.id !== payload.conversation!.id)]);
    return payload.conversation.id;
  }

  async function appendPersistentMessage(id: string, role: "user" | "assistant", content: string, citationCount?: number): Promise<ConversationMessage> {
    const response = await fetch(`/api/ai/conversations/${encodeURIComponent(id)}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ role, content, metadata: citationCount === undefined ? {} : { citationCount, source: "research-assistant" } }) });
    const payload = await response.json() as { message?: ConversationMessage; error?: string };
    if (!response.ok || !payload.message) throw new Error(payload.error ?? "对话消息保存失败");
    return payload.message;
  }

  async function sendQuestion(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || state === "loading") return;
    if (!project.assistantReportId) { setError("这个项目尚未关联可检索报告，AI 不会伪造回答。"); setState("error"); return; }
    if (scope === "all_public") { setError("全站公开检索尚未接入持久化索引；当前版本只允许当前项目范围。"); setState("error"); return; }
    setMessages((current) => [...current, { id: `local-user-${Date.now()}`, role: "user", content: trimmed }]); setQuestion(""); setError(""); setState("loading");
    try {
      let persistedId: string | null = null;
      if (authenticated) { persistedId = await ensureConversation(); await appendPersistentMessage(persistedId, "user", trimmed); }
      const response = await fetch("/api/research/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reportId: project.assistantReportId, question: trimmed, selectedSectionId: scope === "current_file" ? activeFileId : undefined }) });
      const payload = await response.json() as AssistantApiResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "AI 请求失败，请稍后重试。");
      const answer = payload.answer || payload.reason;
      const citationCount = payload.context?.evidence?.length ?? 0;
      if (authenticated && persistedId) await appendPersistentMessage(persistedId, "assistant", answer, citationCount);
      setMessages((current) => [...current, { id: `local-assistant-${Date.now()}`, role: "assistant", content: answer, citations: citationCount }]); setState("ready");
      if (persistedId) { const now = new Date().toISOString(); setHistory((current) => current.map((item) => item.id === persistedId ? { ...item, title: item.title === "新对话" ? trimmed.slice(0, 60) : item.title, updatedAt: now, lastMessageAt: now } : item)); }
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "AI 请求失败，请稍后重试。"); setState("error"); }
  }

  async function openConversation(item: ConversationListItem) {
    setError(""); setState("loading");
    try {
      const response = await fetch(`/api/ai/conversations/${encodeURIComponent(item.id)}`, { cache: "no-store" });
      const payload = await response.json() as { conversation?: Conversation; messages?: ConversationMessage[]; error?: string };
      if (!response.ok || !payload.conversation) throw new Error(payload.error ?? "无法读取历史对话");
      setConversationId(item.id); setMessages((payload.messages ?? []).map(mapMessage).filter((message): message is AssistantMessage => Boolean(message))); setState("ready");
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "无法读取历史对话"); setState("error"); }
  }

  async function archiveConversation(item: ConversationListItem) {
    try { const response = await fetch(`/api/ai/conversations/${encodeURIComponent(item.id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "archive" }) }); if (!response.ok) throw new Error("归档失败"); setHistory((current) => current.filter((entry) => entry.id !== item.id)); if (conversationId === item.id) newConversation(); } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "归档失败"); }
  }
  function newConversation() { setConversationId(null); setMessages([]); setQuestion(""); setError(""); setState("idle"); }

  return <aside className="project-assistant" aria-label="AI 研究助手">
    <header className="assistant-header"><div className="assistant-title"><span><Sparkles size={15} />AI 助手</span><small>{authenticated ? "登录已保存 · 项目证据优先" : authenticated === false ? "匿名体验 · 不保存服务器历史" : "确认登录状态…"}</small></div><div className="assistant-header-actions"><Button size="icon" variant="ghost" aria-label="新对话" title="新对话" onClick={newConversation}><MessageSquarePlus size={16} /></Button><Sheet><SheetTrigger asChild><Button size="icon" variant="ghost" aria-label="历史对话" title="历史对话"><History size={16} /></Button></SheetTrigger><SheetContent><div className="sheet-heading"><SheetTitle>历史对话</SheetTitle><SheetDescription>{authenticated ? "登录后的对话按项目保存，可搜索、恢复或归档。" : "游客对话只保留在当前浏览器会话；登录后可保存历史。"}</SheetDescription></div><label className="history-search"><Search size={15} /><input value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} placeholder="搜索标题或消息" /></label><div className="history-list">{authenticated ? visibleHistory.map((item) => <div key={item.id} className="flex items-center gap-1"><button type="button" className="min-w-0 flex-1" onClick={() => void openConversation(item)}><MessageSquarePlus size={16} /><span><strong>{item.title}</strong><small>{item.pinned ? "已置顶 · " : ""}{new Date(item.updatedAt).toLocaleString("zh-CN")}</small></span></button><button type="button" className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted" aria-label={`归档${item.title}`} title="归档" onClick={() => void archiveConversation(item)}><Archive size={14} /></button></div>) : null}{authenticated && visibleHistory.length === 0 ? <div className="history-empty"><Clock3 size={20} /><p>当前项目还没有已保存的历史对话。</p></div> : null}{authenticated === false ? <div className="history-empty"><Clock3 size={20} /><p>登录后可在这里搜索历史对话。</p><Button size="sm" variant="outline" onClick={callbackToLogin}><LogIn size={14} />登录</Button></div> : null}</div></SheetContent></Sheet></div></header>
    <div className="assistant-context-bar"><DropdownMenu><DropdownMenuTrigger asChild><Button variant="subtle" size="sm"><FileText size={14} />范围：{scopeLabels[scope]}<ChevronDown size={13} /></Button></DropdownMenuTrigger><DropdownMenuContent align="start" className="w-64"><DropdownMenuLabel>本轮读取范围</DropdownMenuLabel><DropdownMenuRadioGroup value={scope} onValueChange={(value) => setScope(value as AssistantScope)}><DropdownMenuRadioItem value="current_file">当前文件 · {activeFileName}</DropdownMenuRadioItem><DropdownMenuRadioItem value="current_project">当前项目 · 按需检索</DropdownMenuRadioItem><DropdownMenuRadioItem value="all_public">全站公开知识 · 暂未开放</DropdownMenuRadioItem></DropdownMenuRadioGroup><DropdownMenuSeparator /><p className="menu-help">私人草稿、其他用户对话和越权项目不会进入上下文。</p></DropdownMenuContent></DropdownMenu><span>{conversationId ? `对话 ${conversationId.slice(0, 8)}` : "新对话"}</span></div>
    <div className="assistant-messages" aria-live="polite" aria-busy={state === "loading"}>{messages.length === 0 && state !== "error" ? <div className="assistant-welcome"><span><Sparkles size={19} /></span><h3>从证据开始提问</h3><p>回答只使用当前 Scope 内可访问的资料。登录后原始消息会保存到私人会话。</p><div><button type="button" onClick={() => setQuestion("这份报告的关键结论和证据边界是什么？")}>梳理结论与边界</button><button type="button" onClick={() => setQuestion("哪些判断仍然缺少独立来源？")}>查找证据缺口</button></div></div> : null}{messages.map((message) => <article key={message.id} className={`assistant-message assistant-message--${message.role}`}><span>{message.role === "user" ? "你" : "AI"}</span><div><p>{message.content}</p>{message.citations !== undefined ? <small>{message.citations} 条上下文证据 · 可审查</small> : null}</div></article>)}{state === "loading" ? <div className="assistant-stage"><Loader2 className="animate-spin" size={16} /><span><strong>检索并重排证据</strong><small>只读取当前 Scope 的 active 来源</small></span></div> : null}{error ? <div className="assistant-inline-error" role="alert">{error}</div> : null}</div>
    <form className="assistant-input" onSubmit={sendQuestion}><textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder={`询问“${activeFileName}”或当前项目`} rows={3} /><div><span>{authenticated ? "登录会话 · 私人保存" : "匿名可用 · 不写入公开内容"}</span><Button type="submit" size="icon" disabled={!question.trim() || state === "loading"} aria-label="发送问题"><Send size={16} /></Button></div></form>
  </aside>;
}
