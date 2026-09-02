"use client";

import { ChevronDown, ChevronRight, Database, File, FileText, Folder, FolderOpen, Globe2, MoreHorizontal, Plus, Upload } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { commandsForNode, createCommands, type FileCommand, type FileCommandId } from "@/lib/ui/file-commands";
import type { SeedFileNode } from "@/lib/ui/platform-seed";

interface ProjectFileTreeProps {
  nodes: SeedFileNode[];
  activeNodeId: string;
  onActiveNodeChange: (nodeId: string) => void;
  onCommand: (command: FileCommandId, node: SeedFileNode | null) => void;
  query?: string;
  /** 拖拽资料到文件树后的业务回调；页面层负责登录、上传意图和分支权限。 */
  onDropFiles?: (files: FileList) => void;
}

const iconByKind = {
  folder: Folder,
  document: FileText,
  source: File,
  data: Database,
};

function NewNodeMenu({ onCommand, parent }: { onCommand: ProjectFileTreeProps["onCommand"]; parent: SeedFileNode | null }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className="tree-icon-action" size="icon" variant="ghost" aria-label={parent ? `在${parent.name}中新建` : "在项目根目录新建"}><Plus size={15} /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>{parent ? `在“${parent.name}”中新建` : "在项目根目录新建"}</DropdownMenuLabel>
        {createCommands.slice(0, 3).map((command) => <DropdownMenuItem key={command.id} onSelect={() => onCommand(command.id, parent)}>{command.id === "create_folder" ? <Folder size={15} /> : <FileText size={15} />}{command.label}</DropdownMenuItem>)}
        <DropdownMenuSeparator />
        {createCommands.slice(3).map((command) => <DropdownMenuItem key={command.id} onSelect={() => onCommand(command.id, parent)}>{command.id === "upload" ? <Upload size={15} /> : command.id === "add_web_source" ? <Globe2 size={15} /> : <FileText size={15} />}{command.label}{command.loginRequired ? <span className="ml-auto text-[10px] text-muted-foreground">需登录</span> : null}</DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CommandItems({ commands, onSelect }: { commands: FileCommand[]; onSelect: (id: FileCommandId) => void }) {
  const splitAt = commands.findIndex((command) => command.id === "rename" || command.id === "contribute");
  return <>{commands.map((command, index) => <span key={command.id} className="contents">{index === splitAt && index > 0 ? <ContextMenuSeparator /> : null}<ContextMenuItem className={command.danger ? "text-destructive focus:text-destructive" : undefined} onSelect={() => onSelect(command.id)}>{command.label}</ContextMenuItem></span>)}</>;
}

function TreeNode({ node, depth, activeNodeId, expanded, setExpanded, onActiveNodeChange, onCommand }: {
  node: SeedFileNode;
  depth: number;
  activeNodeId: string;
  expanded: Set<string>;
  setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>;
  onActiveNodeChange: (nodeId: string) => void;
  onCommand: ProjectFileTreeProps["onCommand"];
}) {
  const isFolder = node.kind === "folder";
  const isOpen = isFolder && expanded.has(node.id);
  const Icon = isFolder && isOpen ? FolderOpen : iconByKind[node.kind];
  const commands = useMemo(() => commandsForNode(node.kind, false), [node.kind]);

  function toggleOrOpen() {
    onActiveNodeChange(node.id);
    if (!isFolder) return;
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(node.id)) next.delete(node.id); else next.add(node.id);
      return next;
    });
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <div className={activeNodeId === node.id ? "tree-node is-active" : "tree-node"} style={{ paddingLeft: 8 + depth * 16 }}>
          <button type="button" className="tree-node__main" onClick={toggleOrOpen} onKeyDown={(event) => { if (event.shiftKey && event.key === "F10") event.currentTarget.parentElement?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })); }}>
            <span className="tree-chevron">{isFolder ? isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : null}</span>
            <Icon size={15} aria-hidden="true" />
            <span>{node.name}</span>
          </button>
          <div className="tree-node__actions">
            {isFolder ? <NewNodeMenu parent={node} onCommand={onCommand} /> : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button className="tree-icon-action" size="icon" variant="ghost" aria-label={`${node.name}更多操作`}><MoreHorizontal size={15} /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-52">
                {commands.map((command) => <DropdownMenuItem key={command.id} className={command.danger ? "text-destructive focus:text-destructive" : undefined} onSelect={() => onCommand(command.id, node)}>{command.label}</DropdownMenuItem>)}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52"><CommandItems commands={commands} onSelect={(command) => onCommand(command, node)} /></ContextMenuContent>
      {isOpen ? <div className="tree-children">{node.children?.length ? node.children.map((child) => <TreeNode key={child.id} node={child} depth={depth + 1} activeNodeId={activeNodeId} expanded={expanded} setExpanded={setExpanded} onActiveNodeChange={onActiveNodeChange} onCommand={onCommand} />) : <p className="tree-empty" style={{ paddingLeft: 36 + depth * 16 }}>空文件夹</p>}</div> : null}
    </ContextMenu>
  );
}

/** 项目文件树的加号、更多按钮和右键菜单全部走同一 Command Registry。 */
export function ProjectFileTree({ nodes, activeNodeId, onActiveNodeChange, onCommand, query = "", onDropFiles }: ProjectFileTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["folder-report", "folder-sources"]));
  const [dropActive, setDropActive] = useState(false);
  function filterNodes(items: SeedFileNode[]): SeedFileNode[] {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    if (!normalized) return items;
    return items.flatMap((item) => {
      const matches = item.name.toLocaleLowerCase("zh-CN").includes(normalized);
      const children = filterNodes(item.children ?? []);
      if (matches || children.length) return [{ ...item, children: matches ? item.children : children.length ? children : undefined }];
      return [];
    });
  }
  const visibleNodes = filterNodes(nodes);
  function readDroppedFiles(event: React.DragEvent<HTMLDivElement>): FileList | null {
    if (event.dataTransfer.files.length > 0) return event.dataTransfer.files;
    // 某些 Chromium/React 合成 drop 事件会暂时暴露空 files，但 items 仍保留 File 对象。
    const files = Array.from(event.dataTransfer.items).map((item) => item.kind === "file" ? item.getAsFile() : null).filter((file): file is File => Boolean(file));
    if (files.length === 0) return null;
    const transfer = new DataTransfer();
    files.forEach((file) => transfer.items.add(file));
    return transfer.files;
  }
  return (
    <div className={dropActive ? "project-tree is-drop-target" : "project-tree"} onDragOver={(event) => { if (!onDropFiles) return; event.preventDefault(); setDropActive(true); }} onDragLeave={(event) => { if (event.currentTarget === event.target) setDropActive(false); }} onDrop={(event) => { if (!onDropFiles) return; event.preventDefault(); setDropActive(false); const files = readDroppedFiles(event); if (files) onDropFiles(files); }}>
      <div className="tree-heading"><span>文件</span><NewNodeMenu parent={null} onCommand={onCommand} /></div>
      {dropActive ? <div className="tree-drop-hint" role="status">松开以加入当前项目草稿</div> : null}
      <div className="tree-list">{visibleNodes.map((node) => <TreeNode key={node.id} node={node} depth={0} activeNodeId={activeNodeId} expanded={expanded} setExpanded={setExpanded} onActiveNodeChange={onActiveNodeChange} onCommand={onCommand} />)}{visibleNodes.length === 0 ? <p className="tree-empty">没有匹配文件</p> : null}</div>
    </div>
  );
}
