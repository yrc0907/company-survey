import type { PublicProjectFileRecord, PublicProjectRecord } from "@/lib/repositories/platform/platform-repository";

/**
 * 将已经通过公开权限投影的项目转换为可下载 Markdown。
 * 输入只能来自 PublicProjectService 的 public + published 结果；这里不查询数据库、OSS 或签名地址。
 */
export interface PublicProjectMarkdownExport {
  content: string;
  filename: string;
}

function inline(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/\0/g, "").trim();
}

function date(value: string | null): string {
  if (!value) return "未提供";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? inline(value) : parsed.toISOString();
}

function fileTree(files: PublicProjectFileRecord[]): string[] {
  const children = new Map<string | null, PublicProjectFileRecord[]>();
  for (const file of files) children.set(file.parentId, [...(children.get(file.parentId) ?? []), file]);
  const visiting = new Set<string>();
  const lines: string[] = [];

  function visit(parentId: string | null, depth: number): void {
    const entries = (children.get(parentId) ?? []).slice().sort((left, right) => left.position - right.position || left.name.localeCompare(right.name, "zh-CN"));
    for (const file of entries) {
      if (visiting.has(file.id)) continue;
      visiting.add(file.id);
      lines.push(`${"  ".repeat(Math.min(depth, 20))}- ${inline(file.name)}${file.kind === "folder" ? "/" : ""}`);
      visit(file.id, depth + 1);
    }
  }

  visit(null, 0);
  return lines;
}

function evidenceLabel(state: NonNullable<PublicProjectRecord["sections"]>[number]["evidenceState"]): string {
  return state === "fact" ? "事实" : state === "inference" ? "推断" : state === "conflict" ? "存在冲突" : "待核验";
}

/** 生成稳定、可审阅的公开报告文本；不会把内部 ID、邮箱、对象键或访问凭据写入文件。 */
export function formatPublicProjectMarkdown(project: PublicProjectRecord): PublicProjectMarkdownExport {
  const sections = project.sections ?? [];
  const files = project.files ?? [];
  const metadata = [
    `- 维护者：${inline(project.owner.displayName)} (@${inline(project.owner.username)})`,
    `- 分类：${inline(project.category ?? "行业")}`,
    `- 状态：公开 · 已发布 · main@v${project.version}`,
    `- 发布时间：${date(project.publishedAt)}`,
    `- 最新修改：${date(project.updatedAt)}`,
    `- 许可证：${inline(project.license)}`,
    `- 阅读：${project.uniqueReaders}`,
    `- Star：${project.starCount}`,
    `- 评论：${project.commentCount ?? 0}`,
    `- 贡献者：${project.contributorCount}`,
    `- 来源：${project.sourceCount}`,
    `- 待处理修改申请：${project.openMergeRequests}`,
  ];
  const tags = (project.tags ?? []).map((tag) => `\`${inline(tag).replace(/`/g, "")}\``).join(" ");
  const tree = fileTree(files);
  const body = [`# ${inline(project.title)}`, "", inline(project.summary), "", ...metadata, tags ? `- 标签：${tags}` : "", "", "## 文件目录", "", ...(tree.length ? tree : ["暂无公开文件"]), "", "## 公开正文", ""];
  if (!sections.length) body.push("暂无公开正文。", "");
  for (const section of sections) {
    body.push(`### ${inline(section.heading)}`, "", `> 证据状态：${evidenceLabel(section.evidenceState)}`, "", section.content.trim() || "暂无正文。", "");
  }

  return { content: `${body.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`, filename: `${inline(project.slug).replace(/[^a-zA-Z0-9\u4e00-\u9fff._-]+/g, "-") || "research-project"}.md` };
}
