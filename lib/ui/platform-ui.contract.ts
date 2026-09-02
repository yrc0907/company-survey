import assert from "node:assert/strict";

import { commandsForNode } from "./file-commands";
import { avatarInitial, avatarTone, formatCompactCount, matchesProjectSearch } from "./platform-format";
import { seedProjects } from "./platform-seed";

/** 可独立执行的 UI 数据契约，防止 Seed 和权限展示在重构后悄悄漂移。 */
function runPlatformUiContract(): void {
  assert.equal(new Set(seedProjects.map((project) => project.id)).size, seedProjects.length, "项目 ID 必须唯一");
  assert.ok(seedProjects.every((project) => project.title && project.owner.username), "首页项目必须包含标题和 owner");
  assert.ok(seedProjects.every((project) => project.publishedAt && project.updatedAt), "首页必须包含发布和最新修改时间");
  assert.ok(seedProjects.every((project) => project.uniqueReaders === 0), "typed seed 不能伪造阅读数");
  assert.ok(seedProjects.every((project) => project.contributors.length === 1 && project.openMergeRequests === 0), "typed seed 不能伪造贡献者或 MR 统计");
  assert.ok(["project-huice", "project-weaver", "project-sangfor", "project-sundray"].every((id) => seedProjects.some((project) => project.id === id)), "四个企业首发项目必须出现在本地首页投影");
  assert.ok(seedProjects.some((project) => project.verification === "verified"), "首发 Seed 必须包含明确已核验项目");
  assert.ok(seedProjects.some((project) => project.verification === "needs_verification"), "首发 Seed 必须包含明确待核验项目");

  assert.equal(formatCompactCount(2384), "2.4k");
  assert.equal(formatCompactCount(Number.NaN), "0");
  assert.equal(avatarInitial(" 慧策"), "慧");
  assert.equal(avatarTone("Yu"), avatarTone("Yu"), "默认头像色必须稳定");
  assert.equal(matchesProjectSearch(["十五五规划", "政策"], "十五五"), true);
  assert.equal(matchesProjectSearch(["跨境 ERP"], "医疗"), false);

  const publicCommands = commandsForNode("document", false).map((command) => command.id);
  assert.ok(publicCommands.includes("contribute"), "公开主版本必须提供发起贡献入口");
  assert.ok(!publicCommands.includes("trash"), "游客不能从公开主版本直接删除文件");
}

runPlatformUiContract();
console.log("platform UI contract passed");
