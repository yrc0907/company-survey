import type { SeedFileNode, SeedProject, SeedSection } from "@/lib/ui/platform-seed";

export interface ProjectFileView {
  node: SeedFileNode;
  heading: string;
  body: string[];
  evidenceState: SeedSection["state"];
  citations: number;
  childCount: number;
  isPlaceholder: boolean;
}

function findSection(project: SeedProject, node: SeedFileNode): SeedSection | undefined {
  const direct = project.sections.find((section) => section.nodeId === node.id || section.id === node.id);
  if (direct || node.kind !== "document") return direct;
  // 旧版 typed seed 使用通用文件 ID；按报告文档顺序映射到对应章节，保持每个文件内容不同。
  const documentNodes = project.files.flatMap((item) => item.children ?? [item]).filter((item) => item.kind === "document");
  const position = documentNodes.findIndex((item) => item.id === node.id);
  return position >= 0 ? project.sections[position] : undefined;
}

/**
 * 将文件树节点投影为可阅读内容。
 * 文档节点优先复用带稳定 ID 的章节；来源、数据和文件夹没有正文时显示明确边界，
 * 不把项目摘要错误复制到每个文件，避免用户点击不同文件却看到同一份内容。
 */
export function projectFileView(project: SeedProject, node: SeedFileNode | undefined): ProjectFileView | null {
  if (!node) return null;
  const section = findSection(project, node);
  if (section) {
    return {
      node,
      heading: section.heading,
      body: section.paragraphs,
      evidenceState: section.state,
      citations: section.citations,
      childCount: node.children?.length ?? 0,
      isPlaceholder: false,
    };
  }

  if (node.kind === "folder") {
    return {
      node,
      heading: node.name,
      body: node.children?.length
        ? [`此文件夹包含 ${node.children.length} 个项目。点击左侧文件名查看对应内容。`]
        : ["这是一个空文件夹，可以从右侧加号创建文件或文件夹。"],
      evidenceState: "needs_verification",
      citations: 0,
      childCount: node.children?.length ?? 0,
      isPlaceholder: true,
    };
  }

  const kindLabel = node.kind === "source" ? "来源文件" : node.kind === "data" ? "数据文件" : "文档";
  return {
    node,
    heading: node.name,
    body: [`${kindLabel}已纳入当前项目文件树。`, "该文件的原始内容需要通过公开来源或登录后的上传解析流程读取。当前不会用项目摘要替代原文。"],
    evidenceState: "needs_verification",
    citations: 0,
    childCount: 0,
    isPlaceholder: true,
  };
}
