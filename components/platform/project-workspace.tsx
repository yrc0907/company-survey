"use client";

import { ArrowLeft, BookOpen, Bot, CheckCircle2, ChevronRight, CircleAlert, Download, Eye, Files, GitBranch, GitMerge, GitPullRequest, History, Loader2, LogIn, MessageCircle, PanelLeftClose, Search, Share2, Star, Users } from "lucide-react";
import { getSession } from "next-auth/react";
import { useEffect, useMemo, useState } from "react";

import { CollaborationPanel } from "@/components/platform/collaboration-panel";
import { ProjectComments, type CommentAnchor } from "@/components/platform/project-comments";
import { ProjectActivity } from "@/components/platform/project-activity";
import { AssistantPanel } from "@/components/platform/assistant-panel";
import { ProjectFileTree } from "@/components/platform/file-tree";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { FileCommandId } from "@/lib/ui/file-commands";
import type { SeedFileNode, SeedProject, SeedSection } from "@/lib/ui/platform-seed";
import { formatCompactCount } from "@/lib/ui/platform-format";
import type { BranchSummary } from "@/lib/domain/collaboration";

interface ProjectWorkspaceProps {
  project: SeedProject;
  onBack: () => void;
  onRequireLogin: (intent: "login" | "upload" | "contribute") => void;
}

const evidenceCopy: Record<SeedSection["state"], string> = {
  fact: "事实",
  inference: "推断",
  needs_verification: "待核验",
  conflict: "存在冲突",
};

const activityEventCopy: Record<string, string> = {
  project_created: "创建了项目",
  commit_created: "提交了修改",
  merge_request_opened: "发起了修改申请",
  merge_request_merged: "合并了修改申请",
  review_submitted: "提交了审核意见",
  comment_created: "发表评论",
  project_starred: "收藏了项目",
  project_unstarred: "取消收藏项目",
};

function findNode(nodes: SeedFileNode[], nodeId: string): SeedFileNode | undefined {
  for (const node of nodes) {
    if (node.id === nodeId) return node;
    const nested = node.children ? findNode(node.children, nodeId) : undefined;
    if (nested) return nested;
  }
  return undefined;
}

function ProjectDocument({ project, viewCount, starCount, commentCount, onActivity, onCommentSection }: { project: SeedProject; viewCount: number; starCount: number; commentCount?: number; onActivity?: (message: string) => void; onCommentSection?: (anchor: CommentAnchor) => void }) {
  const sections = project.sections.length ? project.sections : [{
    id: "seed-boundary",
    heading: "Seed 展示边界",
    paragraphs: ["该项目已进入首发内容目录，但正文与引用仍在迁移核验中。当前页面只展示信息架构，不生成未核验事实。"],
    state: "needs_verification" as const,
    contributor: project.owner,
    mergeRequest: 0,
    reviewer: "待核验",
    citations: 0,
  }];

  return (
    <article className="knowledge-document">
      <header className="document-heading">
        <div className="document-status-line"><span className={project.verification === "verified" ? "verification verification--verified" : "verification verification--pending"}>{project.verification === "verified" ? "Seed 已核验" : "Seed 待核验"}</span><span>公开 · main@v{project.version}</span></div>
        <h1>{project.title}</h1>
        <p>{project.summary}</p>
        <div className="document-byline"><UserAvatar name={project.owner.displayName} size="sm" /><span>由 <strong>{project.owner.displayName}</strong> 维护</span><span>·</span><span>{project.contributorCount ?? project.contributors.length} 位贡献者</span><span>·</span><span>{project.sourceCount} 个来源</span><span>·</span><span><Eye size={13} aria-hidden="true" /> {viewCount} 位读者</span><span>·</span><span><Star size={13} aria-hidden="true" /> {starCount} Star</span>{commentCount !== undefined ? <><span>·</span><span><MessageCircle size={13} aria-hidden="true" /> {commentCount} 评论</span></> : null}</div>
      </header>
      <nav className="document-toc" aria-label="本文目录"><span>本文目录</span>{sections.map((section) => <a key={section.id} href={`#${section.id}`}>{section.heading}</a>)}</nav>
      <div className="document-body">
        {sections.map((section, index) => <section key={section.id} id={section.id} className="knowledge-section">
          <div className="section-gutter"><span>{String(index + 1).padStart(2, "0")}</span><span className={`evidence-state evidence-state--${section.state}`}>{section.state === "fact" ? <CheckCircle2 size={12} /> : <CircleAlert size={12} />}{evidenceCopy[section.state]}</span></div>
          <div className="section-copy">
            <h2>{section.heading}</h2>
            {section.paragraphs.map((paragraph, paragraphIndex) => <p key={paragraphIndex}>{paragraph}</p>)}
            <div className="section-attribution" title={`${section.contributor.displayName} 提交，通过 MR #${section.mergeRequest}，由 ${section.reviewer} 审核`}>
              <UserAvatar name={section.contributor.displayName} size="sm" />
              <span><strong>{section.contributor.displayName}</strong> 贡献{section.mergeRequest ? <> · MR #{section.mergeRequest}</> : null} · {section.reviewer}审核</span>
              {section.nodeId ? <button type="button" onClick={() => onCommentSection?.({ nodeId: section.nodeId!, blockId: `${section.nodeId}:section`, quote: section.paragraphs[0] ?? section.heading, label: section.heading })}>评论此段</button> : null}
              <button type="button" onClick={() => onActivity?.(`“${section.heading}”的贡献 Diff 将在修改申请中打开。`)}>查看 Diff</button>
              <span>{section.citations} 条引用</span>
            </div>
          </div>
        </section>)}
      </div>
    </article>
  );
}

/** 项目详情以稳定三栏承载文件、正文和 AI；未接入能力只展示明确门槛。 */
export function ProjectWorkspace({ project, onBack, onRequireLogin }: ProjectWorkspaceProps) {
  const [activeNodeId, setActiveNodeId] = useState("doc-overview");
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const [activity, setActivity] = useState("");
  const [activeTab, setActiveTab] = useState<"content" | "changes" | "activity">("content");
  const [authenticated, setAuthenticated] = useState(false);
  const [canReview, setCanReview] = useState(false);
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [branchLoading, setBranchLoading] = useState(false);
  const [collaborationError, setCollaborationError] = useState("");
  const [collaborationRefresh, setCollaborationRefresh] = useState(0);
  const [treeQuery, setTreeQuery] = useState("");
  const [dropNotice, setDropNotice] = useState("");
  const [viewCount, setViewCount] = useState(project.uniqueReaders);
  const [viewState, setViewState] = useState<"loading" | "ready" | "ignored" | "error">("loading");
  const [starred, setStarred] = useState(false);
  const [starCount, setStarCount] = useState(project.starCount ?? 0);
  const [commentCount, setCommentCount] = useState<number | undefined>(project.commentCount);
  const [commentAnchor, setCommentAnchor] = useState<CommentAnchor | null>(null);
  const [starState, setStarState] = useState<"loading" | "ready" | "saving" | "error">("loading");
  const [exportState, setExportState] = useState<"idle" | "loading" | "error">("idle");
  const [exportError, setExportError] = useState("");
  const activeNode = useMemo(() => findNode(project.files, activeNodeId), [activeNodeId, project.files]);

  useEffect(() => {
    const firstDocument = project.files.flatMap((node) => node.children ?? [node]).find((node) => node.kind !== "folder");
    setActiveNodeId(firstDocument?.id ?? project.files[0]?.id ?? "");
    setTreeQuery("");
    setCommentCount(project.commentCount);
    setCommentAnchor(null);
  }, [project.id, project.files, project.commentCount]);

  useEffect(() => {
    let cancelled = false;
    setViewCount(project.uniqueReaders);
    setViewState("loading");
    void fetch(`/api/platform/projects/${encodeURIComponent(project.id)}/view`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: "{}",
      credentials: "same-origin",
    }).then(async (response) => {
      const payload = await response.json().catch(() => ({})) as { uniqueReaders?: unknown; recorded?: boolean; ignored?: string };
      if (cancelled) return;
      if (!response.ok) { setViewState("error"); return; }
      if (typeof payload.uniqueReaders === "number" && Number.isFinite(payload.uniqueReaders)) setViewCount(Math.max(0, Math.trunc(payload.uniqueReaders)));
      setViewState(payload.ignored ? "ignored" : "ready");
    }).catch(() => { if (!cancelled) setViewState("error"); });
    return () => { cancelled = true; };
  }, [project.id, project.uniqueReaders]);

  useEffect(() => {
    let cancelled = false;
    setStarred(false);
    setStarCount(project.starCount ?? 0);
    setStarState("loading");
    void fetch(`/api/platform/projects/${encodeURIComponent(project.id)}/star`, { headers: { accept: "application/json" }, credentials: "same-origin", cache: "no-store" }).then(async (response) => {
      const payload = await response.json().catch(() => ({})) as { starred?: unknown; starCount?: unknown };
      if (cancelled) return;
      if (!response.ok) { setStarState("error"); return; }
      setStarred(payload.starred === true);
      if (typeof payload.starCount === "number" && Number.isFinite(payload.starCount)) setStarCount(Math.max(0, Math.trunc(payload.starCount)));
      setStarState("ready");
    }).catch(() => { if (!cancelled) setStarState("error"); });
    return () => { cancelled = true; };
  }, [project.id, project.starCount]);

  async function toggleStar(): Promise<void> {
    if (!authenticated) { onRequireLogin("login"); return; }
    const nextStarred = !starred;
    setStarState("saving");
    try {
      const response = await fetch(`/api/platform/projects/${encodeURIComponent(project.id)}/star`, {
        method: nextStarred ? "POST" : "DELETE",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: "{}",
        credentials: "same-origin",
      });
      const payload = await response.json().catch(() => ({})) as { starred?: unknown; starCount?: unknown; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Star 操作失败");
      setStarred(payload.starred === true);
      if (typeof payload.starCount === "number" && Number.isFinite(payload.starCount)) setStarCount(Math.max(0, Math.trunc(payload.starCount)));
      setStarState("ready");
      setActivity(nextStarred ? "已收藏此项目。" : "已取消收藏此项目。");
    } catch (error) { setStarState("error"); setCollaborationError(error instanceof Error ? error.message : "Star 操作失败"); }
  }

  async function shareProject(): Promise<void> {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setActivity("项目链接已复制。可分享给拥有公开访问权限的读者。");
    } catch {
      setCollaborationError("浏览器未允许访问剪贴板，请手动复制地址栏链接。");
    }
  }

  /** 下载公开主版本的 Markdown；浏览器只接收服务端生成的公开投影，不接触 OSS 原件。 */
  async function exportMarkdown(): Promise<void> {
    setExportState("loading");
    setExportError("");
    try {
      const response = await fetch(`/api/platform/projects/${encodeURIComponent(project.id)}/export?format=markdown`, { headers: { accept: "text/markdown" }, cache: "no-store", credentials: "same-origin" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error ?? "Markdown 导出失败");
      }
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const disposition = response.headers.get("content-disposition") ?? "";
      const encodedFilename = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      anchor.href = href;
      anchor.download = encodedFilename ? decodeURIComponent(encodedFilename) : `${project.slug}.md`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(href);
      setExportState("idle");
      setActivity("Markdown 已导出。");
    } catch (error) {
      setExportState("error");
      setExportError(error instanceof Error ? error.message : "Markdown 导出失败");
    }
  }

  useEffect(() => {
    let mounted = true;
    setBranches([]);
    setCanReview(false);
    setCollaborationError("");
    void getSession().then(async (session) => {
      if (!mounted) return;
      const loggedIn = Boolean(session?.user?.id);
      setAuthenticated(loggedIn);
      if (!loggedIn) return;
      try {
        const response = await fetch(`/api/platform/projects/${encodeURIComponent(project.id)}/branches`, { cache: "no-store" });
        const payload = await response.json() as { branches?: BranchSummary[]; error?: string };
        if (!response.ok) throw new Error(payload.error ?? "草稿分支暂时无法加载");
        if (mounted) setBranches(payload.branches ?? []);
      } catch (error) { if (mounted) setCollaborationError(error instanceof Error ? error.message : "草稿分支暂时无法加载"); }
      try {
        const response = await fetch(`/api/platform/account/project-access?projectId=${encodeURIComponent(project.id)}&action=review_merge_request`, { cache: "no-store" });
        if (mounted) setCanReview(response.ok);
      } catch { if (mounted) setCanReview(false); }
    }).catch(() => { if (mounted) setAuthenticated(false); });
    return () => { mounted = false; };
  }, [project.id]);

  async function ensureDraftBranch(): Promise<BranchSummary | null> {
    const existing = branches.find((branch) => !branch.isProtected && branch.ownerUserId);
    if (existing) return existing;
    if (!authenticated) { onRequireLogin("contribute"); return null; }
    setBranchLoading(true); setCollaborationError("");
    try {
      const response = await fetch(`/api/platform/projects/${encodeURIComponent(project.id)}/branches`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
      const payload = await response.json() as { branch?: BranchSummary; error?: string };
      if (!response.ok || !payload.branch) throw new Error(payload.error ?? "创建草稿分支失败");
      setBranches((current) => [...current.filter((branch) => branch.id !== payload.branch!.id), payload.branch!]);
      setActivity(`已创建草稿分支 ${payload.branch.name}，公开 main 仍保持只读。`);
      return payload.branch;
    } catch (error) { setCollaborationError(error instanceof Error ? error.message : "创建草稿分支失败"); return null; }
    finally { setBranchLoading(false); }
  }

  async function runFileCommand(command: FileCommandId, node: SeedFileNode | null) {
    if (command === "upload") {
      onRequireLogin("upload");
      return;
    }
    if (command === "contribute") {
      onRequireLogin("contribute");
      return;
    }
    const unsupportedCommands: FileCommandId[] = ["paste_text", "add_web_source"];
    if (unsupportedCommands.includes(command)) {
      setActivity("该操作需要内容解析模块；当前先通过上传入口提交文件。");
      return;
    }
    const draft = await ensureDraftBranch();
    if (!draft) return;
    const commandInput = command === "create_folder" || command === "create_document" || command === "create_markdown"
      ? { type: "create_node" as const, parentId: node?.kind === "folder" ? node.id : null, kind: command === "create_folder" ? "folder" as const : "document" as const, name: window.prompt("请输入名称", command === "create_folder" ? "新文件夹" : "新文档")?.trim() ?? "" }
      : command === "rename"
        ? { type: "rename_node" as const, nodeId: node?.id ?? "", name: window.prompt("请输入新名称", node?.name ?? "")?.trim() ?? "" }
        : command === "move"
          ? { type: "move_node" as const, nodeId: node?.id ?? "", parentId: window.prompt("请输入目标文件夹 ID（留空表示根目录）", "")?.trim() || null }
          : command === "duplicate"
            ? { type: "duplicate_node" as const, nodeId: node?.id ?? "", parentId: null, name: window.prompt("请输入副本名称", `${node?.name ?? "文档"} 副本`)?.trim() || undefined }
            : { type: "delete_node" as const, nodeId: node?.id ?? "" };
    if (!commandInput.name && ["create_node", "rename_node"].includes(commandInput.type)) { setActivity("已取消操作。"); return; }
    setBranchLoading(true); setCollaborationError("");
    try {
      const response = await fetch(`/api/platform/branches/${encodeURIComponent(draft.id)}/commands`, { method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ command: commandInput, expectedVersion: draft.version, message: `UI: ${command}`, aiAssisted: false }) });
      const payload = await response.json() as { commit?: { id: string }; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "草稿命令提交失败");
      setBranches((current) => current.map((branch) => branch.id === draft.id ? { ...branch, version: branch.version + 1, headCommitId: payload.commit?.id ?? branch.headCommitId, updatedAt: new Date().toISOString() } : branch));
      setActivity(`已将“${node?.name ?? project.title}”的操作写入草稿 Commit${payload.commit?.id ? ` ${payload.commit.id.slice(0, 8)}` : ""}。`);
    } catch (error) { setCollaborationError(error instanceof Error ? error.message : "草稿命令提交失败"); }
    finally { setBranchLoading(false); }
  }

  /** 文件树接收拖入文件后只进入草稿上传入口，不绕过私有 OSS 和分支权限。 */
  function handleTreeDrop(files: FileList): void {
    const names = Array.from(files).map((file) => file.name).filter(Boolean).slice(0, 8);
    if (!names.length) return;
    if (!authenticated) { onRequireLogin("upload"); return; }
    setDropNotice(`${names.length} 个文件已接收：${names.join("、")}。请通过上传入口确认项目和权限。`);
  }

  async function submitMergeRequest() {
    if (!authenticated) { onRequireLogin("contribute"); return; }
    const draft = await ensureDraftBranch(); if (!draft) return;
    const target = branches.find((branch) => branch.isProtected);
    if (!target) { setCollaborationError("没有找到受保护的 main 分支，暂时无法提交审核。"); return; }
    const title = window.prompt("修改申请标题", `补充：${project.title}`)?.trim(); if (!title) return;
    setBranchLoading(true); setCollaborationError("");
    try {
      const response = await fetch("/api/platform/changes", { method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ projectId: project.id, sourceBranchId: draft.id, targetBranchId: target.id, title, description: "由项目工作台提交的草稿修改" }) });
      const payload = await response.json() as { mergeRequest?: { id: string }; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "提交修改申请失败");
      setActivity(`修改申请已提交${payload.mergeRequest?.id ? ` #${payload.mergeRequest.id.slice(0, 8)}` : ""}，等待项目维护者审核。`); setCollaborationRefresh((value) => value + 1); setActiveTab("changes");
    } catch (error) { setCollaborationError(error instanceof Error ? error.message : "提交修改申请失败"); }
    finally { setBranchLoading(false); }
  }

  return (
    <div className={treeCollapsed ? "workspace-layout tree-is-collapsed" : "workspace-layout"}>
      <header className="project-header">
        <div className="project-header__identity">
          <Button size="icon" variant="ghost" onClick={onBack} aria-label="返回公开项目"><ArrowLeft size={17} /></Button>
          <UserAvatar name={project.owner.displayName} size="sm" />
          <div><span>{project.owner.username}</span><strong>{project.slug}</strong></div>
          <span className="visibility-label"><Eye size={13} />公开</span>
        </div>
        <div className="project-header__actions">
          <div className="mobile-workspace-actions">
            <Sheet>
              <SheetTrigger asChild><Button size="icon" variant="outline" aria-label="打开文件树"><Files size={16} /></Button></SheetTrigger>
              <SheetContent className="mobile-file-sheet">
                <div className="sheet-heading"><SheetTitle>项目文件</SheetTitle><SheetDescription>浏览当前公开版本；修改会进入个人草稿。</SheetDescription></div>
                <div className="branch-row"><GitBranch size={14} /><span>main</span><span>v{project.version}</span></div>
                <ProjectFileTree nodes={project.files} activeNodeId={activeNodeId} onActiveNodeChange={setActiveNodeId} onCommand={runFileCommand} query={treeQuery} onDropFiles={handleTreeDrop} />
              </SheetContent>
            </Sheet>
            <Sheet>
              <SheetTrigger asChild><Button size="icon" variant="outline" aria-label="打开 AI 助手"><Bot size={16} /></Button></SheetTrigger>
              <SheetContent className="mobile-assistant-sheet"><SheetTitle className="sr-only">AI 研究助手</SheetTitle><AssistantPanel project={project} activeFileName={activeNode?.name ?? "研究结论"} activeFileId={activeNode?.id} /></SheetContent>
            </Sheet>
          </div>
          <Button variant={starred ? "subtle" : "ghost"} size="sm" onClick={() => void toggleStar()} disabled={starState === "loading" || starState === "saving"} aria-pressed={starred} title={starState === "error" ? "Star 服务暂不可用，点击可重试" : undefined}>{starState === "saving" ? <Loader2 size={15} className="animate-spin" /> : <Star size={15} fill={starred ? "currentColor" : "none"} />}Star {starCount}</Button>
          <Button variant="ghost" size="sm" onClick={() => void shareProject()}><Share2 size={15} />分享</Button>
          <Button variant="ghost" size="sm" onClick={() => void exportMarkdown()} disabled={exportState === "loading"} aria-busy={exportState === "loading"} title={exportState === "error" ? "导出失败，点击重试" : "下载公开 Markdown"}>{exportState === "loading" ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}导出 Markdown</Button>
          <Button variant="outline" size="sm" onClick={() => void ensureDraftBranch()} disabled={branchLoading}><GitBranch size={15} />创建草稿</Button>
          <Button size="sm" onClick={() => void submitMergeRequest()} disabled={branchLoading}>{branchLoading ? <Loader2 size={15} className="animate-spin" /> : <GitPullRequest size={15} />}提交修改</Button>
          {!authenticated ? <Button variant="ghost" size="sm" onClick={() => onRequireLogin("login")}><LogIn size={15} />登录</Button> : <span className="text-xs text-muted-foreground">已登录</span>}
        </div>
      </header>

      <nav className="project-tabs" aria-label="项目导航"><button className={activeTab === "content" ? "is-active" : undefined} type="button" onClick={() => setActiveTab("content")}><BookOpen size={15} />内容</button><button className={activeTab === "changes" ? "is-active" : undefined} type="button" onClick={() => setActiveTab("changes")}><GitPullRequest size={15} />修改申请 <span>{project.openMergeRequests}</span></button><button type="button" onClick={() => setActivity("问题面板将在有可追踪争议后显示。") }><CircleAlert size={15} />问题</button><button className={activeTab === "activity" ? "is-active" : undefined} type="button" onClick={() => setActiveTab("activity")}><History size={15} />历史</button><button type="button" onClick={() => setActivity("贡献者列表将在首个真实合并后显示。") }><Users size={15} />贡献者</button></nav>

      <aside className="file-sidebar">
        <div className="file-sidebar__tools"><label><Search size={14} /><input value={treeQuery} onChange={(event) => setTreeQuery(event.target.value)} placeholder="搜索当前项目" aria-label="搜索当前项目文件" /></label><Button size="icon" variant="ghost" onClick={() => setTreeCollapsed(true)} aria-label="收起文件树"><PanelLeftClose size={16} /></Button></div>
        <div className="branch-row"><GitBranch size={14} /><span>{branches.find((branch) => branch.isProtected)?.name ?? "main"}</span><span>v{project.version}</span><ChevronRight size={14} /></div>
        <ProjectFileTree nodes={project.files} activeNodeId={activeNodeId} onActiveNodeChange={setActiveNodeId} onCommand={runFileCommand} query={treeQuery} onDropFiles={handleTreeDrop} />
        <div className="sidebar-collaboration"><p>公开主版本为只读</p><span>编辑会进入个人草稿，通过维护者审核后合并并保留署名。</span></div>
      </aside>

      {treeCollapsed ? <Button className="tree-reopen" size="icon" variant="outline" onClick={() => setTreeCollapsed(false)} aria-label="展开文件树"><ChevronRight size={17} /></Button> : null}
      <main className="document-pane">{activeTab === "content" ? <><ProjectDocument project={project} viewCount={viewCount} starCount={starCount} commentCount={commentCount} onActivity={setActivity} onCommentSection={(anchor) => { setCommentAnchor(anchor); window.setTimeout(() => document.getElementById("project-comments-title")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0); }} /><ProjectComments projectId={project.id} authenticated={authenticated} onRequireLogin={() => onRequireLogin("login")} onCountChange={setCommentCount} initialAnchor={commentAnchor} /></> : activeTab === "activity" ? <ProjectActivity projectId={project.id} onSelect={(event) => setActivity(`${event.actor.displayName}：${activityEventCopy[event.eventType] ?? event.eventType}`)} /> : <CollaborationPanel projectId={project.id} authenticated={authenticated} canReview={canReview} onRequireLogin={() => onRequireLogin("login")} refreshToken={collaborationRefresh} />}{viewState === "loading" || starState === "loading" ? <div className="workspace-activity" role="status" aria-live="polite" aria-busy="true"><span>{viewState === "loading" ? "正在记录阅读…" : "正在读取 Star 状态…"}</span></div> : null}{viewState === "error" ? <div className="workspace-activity workspace-activity--error" role="status"><span>阅读统计暂不可用，正文仍可继续浏览。</span></div> : null}{starState === "error" ? <div className="workspace-activity workspace-activity--error" role="status"><span>Star 服务暂不可用，正文仍可继续浏览。</span></div> : null}{viewState === "ready" ? <div className="workspace-activity" role="status" aria-live="polite"><span>阅读已记录 · 去重读者 {viewCount}</span><button type="button" onClick={() => setViewState("ignored")}>关闭</button></div> : null}{exportState === "error" ? <div className="workspace-activity workspace-activity--error" role="alert"><span>{exportError || "Markdown 导出失败"}</span><button type="button" onClick={() => { setExportState("idle"); setExportError(""); }}>关闭</button></div> : null}{collaborationError ? <div className="workspace-activity workspace-activity--error" role="alert"><span>{collaborationError}</span><button type="button" onClick={() => setCollaborationError("")}>关闭</button></div> : null}{dropNotice ? <div className="workspace-activity" role="status"><span>{dropNotice}</span><button type="button" onClick={() => setDropNotice("")}>关闭</button></div> : null}{activity ? <div className="workspace-activity" role="status"><span>{activity}</span><button type="button" onClick={() => setActivity("")}>关闭</button></div> : null}</main>
      <AssistantPanel project={project} activeFileName={activeNode?.name ?? "研究结论"} activeFileId={activeNode?.id} />
    </div>
  );
}
