import type { SeedFileNode, SeedFilePreview, SeedProject, SeedSection } from "@/lib/ui/platform-seed";

export interface ProjectFileView {
  node: SeedFileNode;
  heading: string;
  body: string[];
  evidenceState: SeedSection["state"];
  citations: number;
  childCount: number;
  isPlaceholder: boolean;
  /** 文件类型与来源元数据；正文内容仍由 body/preview.text 原样投影。 */
  preview?: SeedFilePreview;
}

/** 根据文件名选择渲染器；只判断格式，不推断文件内容。 */
export function projectFilePreviewKind(name: string, mimeType?: string): SeedFilePreview["kind"] {
  const normalizedName = name.trim().toLocaleLowerCase("zh-CN");
  const normalizedMime = mimeType?.trim().toLocaleLowerCase("zh-CN") ?? "";
  if (normalizedMime === "application/pdf" || normalizedName.endsWith(".pdf")) return "pdf";
  if (normalizedMime.startsWith("image/") || /\.(png|jpe?g|webp|gif|svg)$/.test(normalizedName)) return "image";
  if (normalizedMime.includes("spreadsheet") || normalizedMime.includes("excel") || /\.(csv|tsv|xlsx|xls)$/.test(normalizedName)) return "spreadsheet";
  if (normalizedMime.includes("markdown") || /\.(md|markdown)$/.test(normalizedName)) return "markdown";
  if (normalizedMime.startsWith("text/") || /\.(txt|log|json|xml|html?)$/.test(normalizedName)) return "text";
  return "unknown";
}

/** 将来源快照按空行拆分，供文件正文阅读；不会改写或总结原文。 */
function snapshotParagraphs(text: string): string[] {
  return text.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean).slice(0, 160);
}

function withInferredPreview(node: SeedFileNode, body?: string[]): SeedFilePreview | undefined {
  if (node.preview) return node.preview;
  // 文档章节已经是公开 Revision 的正文，补充格式标签即可；不把名称当作内容。
  if (body?.length) return { kind: projectFilePreviewKind(node.name), text: body.join("\n\n") };
  return undefined;
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
    const preview = withInferredPreview(node, section.paragraphs);
    return {
      node,
      heading: section.heading,
      body: section.paragraphs,
      evidenceState: section.state,
      citations: section.citations,
      childCount: node.children?.length ?? 0,
      isPlaceholder: false,
      preview,
    };
  }

  // 来源快照/解析产物由 Repository 显式附加；有内容才进入正文，避免点击来源时显示项目摘要。
  if (node.preview?.text || node.preview?.rows?.length || node.preview?.sourceUrl) {
    const body = node.preview.text ? snapshotParagraphs(node.preview.text) : [];
    return {
      node,
      heading: node.name,
      body: body.length ? body : [node.preview.note ?? "该文件提供了公开元数据，但没有可直接展示的文本解析结果。"],
      evidenceState: "needs_verification",
      citations: node.preview.sourceUrl ? 1 : 0,
      childCount: 0,
      isPlaceholder: !node.preview.text && !node.preview.rows?.length && !node.preview.sourceUrl,
      preview: node.preview,
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
  const previewKind = projectFilePreviewKind(node.name);
  return {
    node,
    heading: node.name,
    body: [`${kindLabel}已纳入当前项目文件树。`, "该文件的原始内容需要通过公开来源或登录后的上传解析流程读取。当前不会用项目摘要替代原文。"],
    evidenceState: "needs_verification",
    citations: 0,
    childCount: 0,
    isPlaceholder: true,
    preview: { kind: previewKind, note: "公开版本没有该文件的原件或解析产物，因此不显示猜测性内容。" },
  };
}
