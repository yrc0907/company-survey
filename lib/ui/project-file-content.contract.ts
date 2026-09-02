import assert from "node:assert/strict";

import { projectFilePreviewKind, projectFileView } from "@/lib/ui/project-file-content";
import { getSeedProject } from "@/lib/ui/platform-seed";

/** 文件切换契约：点击不同节点必须得到不同的节点投影，不能重复渲染项目摘要。 */
const project = getSeedProject("project-huice");
assert.ok(project, "慧策 typed seed 必须存在");
const reportFolder = project.files.find((node) => node.kind === "folder" && node.id === "folder-report");
assert.ok(reportFolder?.children?.length, "报告文件夹必须包含文档");
const first = projectFileView(project, reportFolder.children[0]);
const second = projectFileView(project, reportFolder.children[1]);
const source = projectFileView(project, project.files.find((node) => node.id === "folder-sources")?.children?.[0]);
assert.ok(first && second && source, "文档和来源节点必须可投影");
assert.notEqual(first.heading, second.heading, "不同文档不能显示相同标题");
assert.notEqual(first.body.join("\n"), second.body.join("\n"), "不同文档不能显示相同正文");
assert.equal(source.isPlaceholder, true, "没有正文快照的来源必须明确显示待核验占位");
assert.equal(projectFilePreviewKind("访谈.md"), "markdown");
assert.equal(projectFilePreviewKind("数据.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), "spreadsheet");
const pdfNode = { id: "source-contract-pdf", name: "公告.pdf", kind: "source" as const, preview: { kind: "pdf" as const, text: "第一页\n\n公开来源原文片段", sourceUrl: "https://example.com/report.pdf", contentHash: "a".repeat(64) } };
const pdf = projectFileView(project, pdfNode);
assert.ok(pdf, "带公开快照的 PDF 节点必须可投影");
assert.equal(pdf.isPlaceholder, false, "有文本快照的 PDF 不能显示为空占位");
assert.equal(pdf.body[0], "第一页", "文件预览必须保留来源原文段落");
console.log("project file content contract: passed");
