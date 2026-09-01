"use client";

import { ArrowLeft, BookOpen, Bot, CheckCircle2, ChevronRight, CircleAlert, Eye, Files, GitBranch, GitPullRequest, History, LogIn, PanelLeftClose, Search, Share2, Users } from "lucide-react";
import { useMemo, useState } from "react";

import { AssistantPanel } from "@/components/platform/assistant-panel";
import { ProjectFileTree } from "@/components/platform/file-tree";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { FileCommandId } from "@/lib/ui/file-commands";
import type { SeedFileNode, SeedProject, SeedSection } from "@/lib/ui/platform-seed";
import { formatCompactCount } from "@/lib/ui/platform-format";

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

function findNode(nodes: SeedFileNode[], nodeId: string): SeedFileNode | undefined {
  for (const node of nodes) {
    if (node.id === nodeId) return node;
    const nested = node.children ? findNode(node.children, nodeId) : undefined;
    if (nested) return nested;
  }
  return undefined;
}

function ProjectDocument({ project }: { project: SeedProject }) {
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
        <div className="document-byline"><UserAvatar name={project.owner.displayName} size="sm" /><span>由 <strong>{project.owner.displayName}</strong> 维护</span><span>·</span><span>{project.contributors.length} 位贡献者</span><span>·</span><span>{project.sourceCount} 个来源</span></div>
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
              <button type="button">查看 Diff</button>
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
  const activeNode = useMemo(() => findNode(project.files, activeNodeId), [activeNodeId, project.files]);

  function runFileCommand(command: FileCommandId, node: SeedFileNode | null) {
    if (command === "upload") {
      onRequireLogin("upload");
      return;
    }
    if (command === "contribute") {
      onRequireLogin("contribute");
      return;
    }
    const localDraftCommands: FileCommandId[] = ["create_document", "create_markdown", "create_folder", "paste_text", "add_web_source", "rename", "move", "duplicate", "trash"];
    if (localDraftCommands.includes(command)) {
      setActivity(`“${node?.name ?? project.title}”的${command.replaceAll("_", " ")}将在游客本地草稿中执行；IndexedDB 持久化尚未接入。`);
      return;
    }
    if (command === "copy_link") {
      void navigator.clipboard?.writeText(window.location.href);
      setActivity("项目链接已复制。正式版会生成文件级永久链接。");
      return;
    }
    setActivity(`已选择“${node?.name ?? project.title}”的${command}操作；对应版本视图正在接入。`);
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
                <ProjectFileTree nodes={project.files} activeNodeId={activeNodeId} onActiveNodeChange={setActiveNodeId} onCommand={runFileCommand} />
              </SheetContent>
            </Sheet>
            <Sheet>
              <SheetTrigger asChild><Button size="icon" variant="outline" aria-label="打开 AI 助手"><Bot size={16} /></Button></SheetTrigger>
              <SheetContent className="mobile-assistant-sheet"><SheetTitle className="sr-only">AI 研究助手</SheetTitle><AssistantPanel project={project} activeFileName={activeNode?.name ?? "研究结论"} /></SheetContent>
            </Sheet>
          </div>
          <Button variant="ghost" size="sm"><Share2 size={15} />分享</Button>
          <Button variant="outline" size="sm" onClick={() => onRequireLogin("contribute")}><GitBranch size={15} />创建草稿</Button>
          <Button size="sm" onClick={() => onRequireLogin("contribute")}><GitPullRequest size={15} />提交修改</Button>
          <Button variant="ghost" size="sm" onClick={() => onRequireLogin("login")}><LogIn size={15} />登录</Button>
        </div>
      </header>

      <nav className="project-tabs" aria-label="项目导航"><button className="is-active" type="button"><BookOpen size={15} />内容</button><button type="button"><GitPullRequest size={15} />修改申请 <span>{project.openMergeRequests}</span></button><button type="button"><CircleAlert size={15} />问题</button><button type="button"><History size={15} />历史</button><button type="button"><Users size={15} />贡献者</button></nav>

      <aside className="file-sidebar">
        <div className="file-sidebar__tools"><label><Search size={14} /><input placeholder="搜索当前项目" /></label><Button size="icon" variant="ghost" onClick={() => setTreeCollapsed(true)} aria-label="收起文件树"><PanelLeftClose size={16} /></Button></div>
        <div className="branch-row"><GitBranch size={14} /><span>main</span><span>v{project.version}</span><ChevronRight size={14} /></div>
        <ProjectFileTree nodes={project.files} activeNodeId={activeNodeId} onActiveNodeChange={setActiveNodeId} onCommand={runFileCommand} />
        <div className="sidebar-collaboration"><p>公开主版本为只读</p><span>编辑会进入个人草稿，通过维护者审核后合并并保留署名。</span></div>
      </aside>

      {treeCollapsed ? <Button className="tree-reopen" size="icon" variant="outline" onClick={() => setTreeCollapsed(false)} aria-label="展开文件树"><ChevronRight size={17} /></Button> : null}
      <main className="document-pane"><ProjectDocument project={project} />{activity ? <div className="workspace-activity" role="status"><span>{activity}</span><button type="button" onClick={() => setActivity("")}>关闭</button></div> : null}</main>
      <AssistantPanel project={project} activeFileName={activeNode?.name ?? "研究结论"} />
    </div>
  );
}
