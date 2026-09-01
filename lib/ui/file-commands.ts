import type { FileNodeKind } from "@/lib/ui/platform-seed";

export type FileCommandId =
  | "open"
  | "create_document"
  | "create_markdown"
  | "create_folder"
  | "upload"
  | "paste_text"
  | "add_web_source"
  | "rename"
  | "move"
  | "duplicate"
  | "copy_link"
  | "history"
  | "compare"
  | "attribution"
  | "download"
  | "parse"
  | "trash"
  | "contribute";

export interface FileCommand {
  id: FileCommandId;
  label: string;
  danger?: boolean;
  loginRequired?: boolean;
}

export const createCommands: FileCommand[] = [
  { id: "create_document", label: "新建文档" },
  { id: "create_markdown", label: "新建 Markdown" },
  { id: "create_folder", label: "新建文件夹" },
  { id: "upload", label: "上传文件", loginRequired: true },
  { id: "paste_text", label: "粘贴文本" },
  { id: "add_web_source", label: "添加网页来源" },
];

/** 右键、更多按钮与快捷键共享同一命令定义；此处只描述 UI 可见性，不代替服务端权限。 */
export function commandsForNode(kind: FileNodeKind, canEditPublished: boolean): FileCommand[] {
  const readCommands: FileCommand[] = [
    { id: "open", label: "打开" },
    { id: "copy_link", label: "复制链接" },
    { id: "history", label: "查看历史" },
    { id: "attribution", label: "贡献追踪" },
  ];
  if (!canEditPublished) return [...readCommands, { id: "contribute", label: "在个人草稿中修改" }];

  const editCommands: FileCommand[] = [
    { id: "rename", label: "重命名" },
    { id: "move", label: "移动到" },
    { id: "duplicate", label: "创建副本" },
  ];
  const kindCommands: FileCommand[] = kind === "source"
    ? [{ id: "download", label: "下载原始文件" }, { id: "parse", label: "查看解析结果" }]
    : kind === "document"
      ? [{ id: "compare", label: "比较版本" }]
      : [];
  return [...readCommands, ...editCommands, ...kindCommands, { id: "trash", label: "移到回收站", danger: true }];
}
