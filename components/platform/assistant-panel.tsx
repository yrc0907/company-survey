"use client";

import { Archive, ChevronDown, Clock3, FileText, History, Loader2, LogIn, MessageSquarePlus, Paperclip, Search, Send, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { LoginGateDialog } from "@/components/platform/login-gate-dialog";
import { KnowledgeTaskPanel } from "@/components/platform/knowledge-task-panel";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { Conversation, ConversationMessage } from "@/lib/domain/memory";
import type { SeedProject } from "@/lib/ui/platform-seed";

type AssistantScope = "current_file" | "current_project" | "all_public";
type AssistantState = "idle" | "loading" | "ready" | "error";
interface Citation { id: string; title: string; sourceId: string; page: number | null; url: string | null; }
interface AssistantMessage { id: string; role: "user" | "assistant"; content: string; citations?: Citation[]; }
interface WorkflowTrace { selectedAgents: string[]; findings: Array<{ agent: string; status: "completed" | "degraded"; summary: string }>; }
interface AssistantApiResponse { status: "context_ready" | "degraded"; reason: string; answer?: string; context?: { evidence?: unknown[] }; workflow?: WorkflowTrace; }
interface ConversationListItem { id: string; title: string; projectId: string | null; updatedAt: string; lastMessageAt: string | null; pinned: boolean; }

const scopeLabels: Record<AssistantScope, string> = { current_file: "当前文件", current_project: "当前项目", all_public: "全站公开知识" };
interface AssistantPanelProps { project: SeedProject; activeFileName: string; activeFileId?: string; }

/** 发送统一事件，由当前面板展示登录门槛，避免跳转到认证表单。 */
function callbackToLogin(): void { window.dispatchEvent(new Event("research:login-request")); }

function mapMessage(message: ConversationMessage): AssistantMessage | null {
  if (message.role !== "user" && message.role !== "assistant") return null;
  const citations = Array.isArray(message.metadata.citations) ? message.metadata.citations.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const value = item as Record<string, unknown>;
    return typeof value.id === "string" && typeof value.title === "string" ? [{ id: value.id, title: value.title, sourceId: typeof value.sourceId === "string" ? value.sourceId : "", page: typeof value.page === "number" ? value.page : null, url: typeof value.url === "string" ? value.url : null }] : [];
  }) : undefined;
  return { id: message.id, role: message.role, content: message.content, citations };
}
function mapConversation(item: Conversation): ConversationListItem { return { id: item.id, title: item.title, projectId: item.projectId, updatedAt: item.updatedAt, lastMessageAt: item.lastMessageAt, pinned: item.pinned }; }
function flattenFileNames(nodes: SeedProject["files"]): Array<{ id: string; name: string }> {
  return nodes.flatMap((node) => [{ id: node.id, name: node.name }, ...(node.children ? flattenFileNames(node.children) : [])]);
}

/** AI 侧栏：仅登录用户可调用模型和持久化会话；游客只看到内测开放占位。 */
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
  const [attachments, setAttachments] = useState<string[]>([]);
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [loginOpen, setLoginOpen] = useState(false);
  const [workflow, setWorkflow] = useState<WorkflowTrace | null>(null);

  useEffect(() => {
    const openGate = () => setLoginOpen(true);
    window.addEventListener("research:login-request", openGate);
    return () => window.removeEventListener("research:login-request", openGate);
  }, []);

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

  useEffect(() => {
    if (authenticated !== true) return;
    if (!historySearch.trim()) {
      void fetch(`/api/ai/conversations?projectId=${encodeURIComponent(project.id)}&status=active`, { cache: "no-store" }).then(async (response) => {
        if (!response.ok) return;
        const payload = await response.json() as { conversations?: Conversation[] };
        setHistory((payload.conversations ?? []).map(mapConversation));
      });
      return;
    }
    const timer = window.setTimeout(() => {
      void fetch(`/api/ai/conversations?projectId=${encodeURIComponent(project.id)}&status=active&q=${encodeURIComponent(historySearch.trim())}`, { cache: "no-store" }).then(async (response) => {
        if (!response.ok) return;
        const payload = await response.json() as { conversations?: Conversation[] };
        setHistory((payload.conversations ?? []).map(mapConversation));
      }).catch(() => setNotice("对话搜索暂时失败，显示最近已加载的会话。"));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [authenticated, historySearch, project.id]);

  const conversationTitle = messages.find((message) => message.role === "user")?.content.slice(0, 60) || "新对话";
  // 历史搜索由服务器同时检索标题和消息正文；不能在客户端再次按标题过滤掉正文命中的会话。
  const visibleHistory = useMemo(() => history, [history]);
  const fileReferences = useMemo(() => flattenFileNames(project.files), [project.files]);
  const referenceQuery = question.slice(question.lastIndexOf("@") + 1).trim().toLocaleLowerCase("zh-CN");
  const referenceCandidates = useMemo(() => fileReferences.filter((item) => item.name.toLocaleLowerCase("zh-CN").includes(referenceQuery)).slice(0, 8), [fileReferences, referenceQuery]);

  function updateQuestion(value: string): void {
    setQuestion(value);
    const at = value.lastIndexOf("@");
    setReferenceOpen(at >= 0 && !value.slice(at).includes(" ") && referenceCandidates.length > 0);
  }
  function chooseReference(name: string): void { const at = question.lastIndexOf("@"); updateQuestion(`${question.slice(0, at)}@${name} `); setReferenceOpen(false); setNotice(`已添加文件引用：${name}`); }
  function acceptDroppedFiles(files: FileList | File[]): void {
    const names = Array.from(files).map((file) => file.name).filter(Boolean);
    if (!names.length) return;
    setAttachments((current) => Array.from(new Set([...current, ...names])).slice(0, 8));
    setNotice(`${names.length} 个文件已加入待处理附件；解析完成后才能作为证据检索。`);
  }
  function onInputDrop(event: React.DragEvent<HTMLTextAreaElement>): void { event.preventDefault(); acceptDroppedFiles(event.dataTransfer.files); }

  async function ensureConversation(): Promise<string> {
    if (conversationId) return conversationId;
    const response = await fetch("/api/ai/conversations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: conversationTitle, projectId: project.id }) });
    const payload = await response.json() as { conversation?: Conversation; error?: string };
    if (!response.ok || !payload.conversation) throw new Error(payload.error ?? "无法创建持久化对话");
    setConversationId(payload.conversation.id);
    setHistory((current) => [mapConversation(payload.conversation!), ...current.filter((item) => item.id !== payload.conversation!.id)]);
    return payload.conversation.id;
  }

  async function appendPersistentMessage(id: string, role: "user" | "assistant", content: string, citations?: Citation[]): Promise<ConversationMessage> {
    const metadata = citations === undefined ? {} : { citationCount: citations.length, citations, source: "research-assistant" };
    const response = await fetch(`/api/ai/conversations/${encodeURIComponent(id)}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ role, content, metadata }) });
    const payload = await response.json() as { message?: ConversationMessage; error?: string };
    if (!response.ok || !payload.message) throw new Error(payload.error ?? "对话消息保存失败");
    return payload.message;
  }

  async function sendQuestion(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || state === "loading") return;
    if (authenticated !== true) {
      setLoginOpen(true);
      setNotice("AI 助手暂仅对内测用户开放，请先登录。");
      return;
    }
    if (!project.assistantReportId) { setError("这个项目尚未关联可检索报告，AI 不会伪造回答。"); setState("error"); return; }
    if (scope === "all_public") { setError("全站公开检索尚未接入持久化索引；当前版本只允许当前项目范围。"); setState("error"); return; }
    const prompt = attachments.length ? `${trimmed}\n\n[待处理附件：${attachments.join("、")}]` : trimmed;
    setMessages((current) => [...current, { id: `local-user-${Date.now()}`, role: "user", content: prompt }]); setQuestion(""); setReferenceOpen(false); setError(""); setNotice(""); setState("loading");
    try {
      let persistedId: string | null = null;
      if (authenticated) { persistedId = await ensureConversation(); await appendPersistentMessage(persistedId, "user", prompt); }
      const response = await fetch("/api/research/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reportId: project.assistantReportId, projectId: project.id, scope, question: trimmed, selectedSectionId: scope === "current_file" ? activeFileId : undefined }) });
      const payload = await response.json() as AssistantApiResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "AI 请求失败，请稍后重试。");
      const answer = payload.answer || payload.reason;
      const citations: Citation[] = (payload.context?.evidence ?? []).flatMap((item) => {
        if (typeof item !== "object" || item === null) return [];
        const value = item as Record<string, unknown>;
        return typeof value.chunkId === "string" && typeof value.title === "string" ? [{ id: value.chunkId, title: value.title, sourceId: typeof value.sourceId === "string" ? value.sourceId : "", page: typeof value.page === "number" ? value.page : null, url: typeof value.url === "string" ? value.url : null }] : [];
      });
      if (authenticated && persistedId) await appendPersistentMessage(persistedId, "assistant", answer, citations);
      setAttachments([]); setWorkflow(payload.workflow ?? null);
      setMessages((current) => [...current, { id: `local-assistant-${Date.now()}`, role: "assistant", content: answer, citations }]); setState("ready"); setNotice(authenticated ? "回答和引用已保存到当前私人会话。" : "回答已生成；游客会话不会写入服务器。");
      if (persistedId) { const now = new Date().toISOString(); setHistory((current) => current.map((item) => item.id === persistedId ? { ...item, title: item.title === "新对话" ? trimmed.slice(0, 60) : item.title, updatedAt: now, lastMessageAt: now } : item)); }
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "AI 请求失败，请稍后重试。"); setState("error"); }
  }

  async function openConversation(item: ConversationListItem) {
    setError(""); setState("loading");
    try {
      const response = await fetch(`/api/ai/conversations/${encodeURIComponent(item.id)}`, { cache: "no-store" });
      const payload = await response.json() as { conversation?: Conversation; messages?: ConversationMessage[]; error?: string };
      if (!response.ok || !payload.conversation) throw new Error(payload.error ?? "无法读取历史对话");
      setConversationId(item.id); setMessages((payload.messages ?? []).map(mapMessage).filter((message): message is AssistantMessage => Boolean(message))); setAttachments([]); setNotice("历史对话已恢复。"); setState("ready");
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "无法读取历史对话"); setState("error"); }
  }

  async function archiveConversation(item: ConversationListItem) {
    try { const response = await fetch(`/api/ai/conversations/${encodeURIComponent(item.id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "archive" }) }); if (!response.ok) throw new Error("归档失败"); setHistory((current) => current.filter((entry) => entry.id !== item.id)); if (conversationId === item.id) newConversation(); setNotice("对话已归档。"); } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "归档失败"); }
  }
  function newConversation() { setConversationId(null); setMessages([]); setAttachments([]); setWorkflow(null); setQuestion(""); setError(""); setNotice("已新建空白对话，发送第一条消息后会保存。"); setState("idle"); }

  return <aside className="project-assistant" aria-label="AI 研究助手">
    <header className="assistant-header"><div className="assistant-title"><span><Sparkles size={15} />AI 助手</span><small>{authenticated ? "登录已保存 · 项目证据优先" : authenticated === false ? "仅限内测用户 · 暂不对外开放" : "确认登录状态…"}</small></div><div className="assistant-header-actions"><Button size="icon" variant="ghost" aria-label="新对话" title="新对话" onClick={newConversation}><MessageSquarePlus size={16} /></Button><Sheet><SheetTrigger asChild><Button size="icon" variant="ghost" aria-label="历史对话" title="历史对话"><History size={16} /></Button></SheetTrigger><SheetContent><div className="sheet-heading"><SheetTitle>历史对话</SheetTitle><SheetDescription>{authenticated ? "登录后的对话按项目保存，可搜索、恢复或归档。" : "登录后才能使用 AI 助手并保存历史对话。"}</SheetDescription></div><label className="history-search"><Search size={15} /><input value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} placeholder="搜索标题或消息" disabled={authenticated !== true} /></label><div className="history-list">{authenticated ? visibleHistory.map((item) => <div key={item.id} className="flex items-center gap-1"><button type="button" className="min-w-0 flex-1" onClick={() => void openConversation(item)}><MessageSquarePlus size={16} /><span><strong>{item.title}</strong><small>{item.pinned ? "已置顶 · " : ""}{new Date(item.updatedAt).toLocaleString("zh-CN")}</small></span></button><button type="button" className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted" aria-label={`归档${item.title}`} title="归档" onClick={() => void archiveConversation(item)}><Archive size={14} /></button></div>) : null}{authenticated && visibleHistory.length === 0 ? <div className="history-empty"><Clock3 size={20} /><p>当前项目还没有已保存的历史对话。</p></div> : null}{authenticated === false ? <div className="history-empty"><Clock3 size={20} /><p>AI 助手暂仅对内测用户开放。</p><Button size="sm" variant="outline" onClick={callbackToLogin}><LogIn size={14} />登录</Button></div> : null}</div></SheetContent></Sheet></div></header>
    <div className="assistant-context-bar"><DropdownMenu><DropdownMenuTrigger asChild><Button variant="subtle" size="sm"><FileText size={14} />范围：{scopeLabels[scope]}<ChevronDown size={13} /></Button></DropdownMenuTrigger><DropdownMenuContent align="start" className="w-64"><DropdownMenuLabel>本轮读取范围</DropdownMenuLabel><DropdownMenuRadioGroup value={scope} onValueChange={(value) => setScope(value as AssistantScope)}><DropdownMenuRadioItem value="current_file">当前文件 · {activeFileName}</DropdownMenuRadioItem><DropdownMenuRadioItem value="current_project">当前项目 · 按需检索</DropdownMenuRadioItem><DropdownMenuRadioItem value="all_public">全站公开知识 · 暂未开放</DropdownMenuRadioItem></DropdownMenuRadioGroup><DropdownMenuSeparator /><p className="menu-help">私人草稿、其他用户对话和越权项目不会进入上下文。</p></DropdownMenuContent></DropdownMenu><span>{conversationId ? `对话 ${conversationId.slice(0, 8)}` : "新对话"}</span></div>
    <KnowledgeTaskPanel projectId={project.id} reportId={project.assistantReportId ?? project.id} question={question} authenticated={authenticated} onRequireLogin={() => setLoginOpen(true)} />
    <div className="assistant-messages" aria-live="polite" aria-busy={state === "loading"}>{authenticated === false && messages.length === 0 ? <div className="assistant-welcome"><span><LogIn size={19} /></span><h3>AI 助手暂仅对内测用户开放</h3><p>登录后才能检索当前项目证据、创建新对话和恢复历史记录。</p><div><button type="button" onClick={callbackToLogin}>登录后使用</button></div></div> : null}{authenticated !== false && messages.length === 0 && state !== "error" ? <div className="assistant-welcome"><span><Sparkles size={19} /></span><h3>从证据开始提问</h3><p>回答只使用当前 Scope 内可访问的资料。登录后原始消息会保存到私人会话。</p><div><button type="button" onClick={() => setQuestion("这份报告的关键结论和证据边界是什么？")}>梳理结论与边界</button><button type="button" onClick={() => setQuestion("哪些判断仍然缺少独立来源？")}>查找证据缺口</button></div></div> : null}{messages.map((message) => <article key={message.id} className={`assistant-message assistant-message--${message.role}`}><span>{message.role === "user" ? "你" : "AI"}</span><div><p>{message.content}</p>{message.citations?.length ? <div className="mt-2 grid gap-1 text-[10px] text-muted-foreground"><span>证据引用</span>{message.citations.map((citation, index) => citation.url ? <a key={citation.id} href={citation.url} target="_blank" rel="noreferrer" className="truncate text-primary hover:underline">[{index + 1}] {citation.title}{citation.page ? ` · 第 ${citation.page} 页` : ""}</a> : <button key={citation.id} type="button" className="truncate text-left text-primary hover:underline" onClick={() => setNotice(`证据 ${citation.id.slice(0, 8)}：${citation.title}${citation.page ? `，第 ${citation.page} 页` : ""}`)}>[{index + 1}] {citation.title}{citation.page ? ` · 第 ${citation.page} 页` : ""}</button>)}</div> : null}</div></article>)}{workflow ? <div className="assistant-stage"><span><strong>协作 Agent：{workflow.selectedAgents.join(" · ")}</strong><small>{workflow.findings.map((finding) => `${finding.agent}: ${finding.status === "completed" ? "完成" : "降级"}`).join(" · ")}</small></span></div> : null}{state === "loading" ? <div className="assistant-stage"><Loader2 className="animate-spin" size={16} /><span><strong>检索并执行协作 Agent</strong><small>只读取当前 Scope 的 active 来源</small></span></div> : null}{error ? <div className="assistant-inline-error" role="alert">{error}</div> : null}{notice ? <div className="assistant-inline-notice" role="status">{notice}</div> : null}</div>
    <form className="assistant-input" onSubmit={sendQuestion} onDragOver={(event) => { event.preventDefault(); event.currentTarget.classList.add("is-drop-target"); }} onDragLeave={(event) => event.currentTarget.classList.remove("is-drop-target")} onDrop={(event) => { event.preventDefault(); event.currentTarget.classList.remove("is-drop-target"); acceptDroppedFiles(event.dataTransfer.files); }}><div className="mb-1 flex flex-wrap gap-1">{attachments.map((name) => <span key={name} className="inline-flex max-w-full items-center gap-1 rounded border bg-muted px-1.5 py-1 text-[10px] text-muted-foreground"><Paperclip size={11} /><span className="max-w-40 truncate">{name}</span><button type="button" aria-label={`移除附件${name}`} title="移除附件" onClick={() => setAttachments((current) => current.filter((item) => item !== name))}><X size={11} /></button></span>)}</div><textarea value={question} onChange={(event) => updateQuestion(event.target.value)} onDragOver={(event) => event.preventDefault()} onDrop={onInputDrop} placeholder={authenticated === false ? "登录后使用 AI 助手" : `询问“${activeFileName}”或当前项目；可拖入文件，输入 @ 引用`} rows={3} disabled={authenticated !== true} />{referenceOpen ? <div className="relative"><div className="absolute bottom-1 left-0 right-0 z-10 grid max-h-44 gap-0.5 overflow-y-auto rounded-md border bg-background p-1 shadow-lg">{referenceCandidates.map((item) => <button key={item.id} type="button" className="flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted" onClick={() => chooseReference(item.name)}><FileText size={13} className="text-muted-foreground" /><span className="truncate">{item.name}</span></button>)}</div></div> : null}<div><span>{authenticated === true ? "登录会话 · 私人保存" : "仅限内测用户"}</span><Button type={authenticated === true ? "submit" : "button"} size="icon" disabled={authenticated === null || (authenticated === true && (!question.trim() || state === "loading"))} onClick={authenticated === true ? undefined : () => setLoginOpen(true)} aria-label={authenticated === true ? "发送问题" : "登录后使用 AI 助手"} title={authenticated === true ? "发送问题" : "登录后使用 AI 助手"}>{authenticated === true ? <Send size={16} /> : <LogIn size={16} />}</Button></div></form>
    <LoginGateDialog open={loginOpen} intent="login" onOpenChange={setLoginOpen} />
  </aside>;
}
