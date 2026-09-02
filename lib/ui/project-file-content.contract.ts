import assert from "node:assert/strict";

import { projectFileView } from "@/lib/ui/project-file-content";
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
console.log("project file content contract: passed");
