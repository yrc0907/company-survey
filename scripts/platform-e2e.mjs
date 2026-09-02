import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env.PLATFORM_BASE_URL || "http://127.0.0.1:3101";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const checks = [];

async function check(id, action) {
  try {
    await action();
    checks.push({ id, status: "passed" });
  } catch (error) {
    checks.push({ id, status: "failed", message: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

try {
  await check("E2E-HOME-001", async () => {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await page.getByRole("region", { name: "公开研究项目" }).waitFor();
    await page.getByRole("textbox", { name: "Ctrl K" }).fill("慧策");
    await page.getByRole("tab", { name: "阅读最多" }).click();
    await page.getByRole("button", { name: /打开慧策/ }).waitFor();
  });

  await check("E2E-HOME-003", async () => {
    const response = await page.request.get(`${baseUrl}/api/platform/search?q=${encodeURIComponent("慧策")}&limit=20`, { headers: { accept: "application/json" } });
    assert.equal(response.status(), 200);
    const body = await response.json();
    assert.ok(Array.isArray(body.results));
    assert.ok(body.results.some((result) => result.kind === "project" && String(result.title).includes("慧策")));
  });

  await check("E2E-HOME-002", async () => {
    await page.getByRole("button", { name: "# 十五五规划 12" }).click();
    assert.equal(await page.getByRole("textbox", { name: "Ctrl K" }).inputValue(), "十五五规划");
    await page.keyboard.press("Control+K");
    assert.equal(await page.getByRole("textbox", { name: "Ctrl K" }).evaluate((element) => document.activeElement === element), true);
  });

  await check("E2E-PROJECT-001", async () => {
    await page.getByRole("textbox", { name: "Ctrl K" }).fill("慧策");
    await page.getByRole("button", { name: /打开慧策/ }).click();
    await page.getByRole("heading", { name: /慧策掌上先机/ }).waitFor();
    await page.getByRole("button", { name: "官方资料.pdf", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "官方资料.pdf", exact: true }).locator("..", { hasText: "官方资料.pdf" }).count(), 1);
    // 申请数量来自真实数据库，不能把本地 seed 的计数写死；只验证入口和面板能打开。
    await page.getByRole("button", { name: /修改申请(?:\s+\d+)?/ }).click();
    await page.getByRole("region", { name: "修改申请" }).waitFor();
  });

  await check("E2E-PROJECT-002", async () => {
    await page.getByRole("textbox", { name: "搜索当前项目文件" }).fill("官方");
    await page.getByRole("button", { name: "官方资料.pdf", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "公开访谈摘录.md", exact: true }).count(), 0);
    await page.getByRole("button", { name: "分享" }).click();
    const feedback = page.locator('[role="status"], [role="alert"]').filter({ hasText: /项目链接已复制|剪贴板/ });
    await feedback.waitFor();
  });

  await check("E2E-PROJECT-004", async () => {
    await page.getByRole("button", { name: "历史", exact: true }).click();
    await page.getByRole("heading", { name: "活动时间线" }).waitFor();
    await page.getByRole("button", { name: "内容", exact: true }).click();
  });

  await check("E2E-PROJECT-003", async () => {
    // 上一个场景打开了修改申请 Tab；讨论属于内容 Tab，先恢复到明确的 UI 状态。
    await page.getByRole("button", { name: /内容/ }).click();
    await page.getByRole("heading", { name: "讨论" }).waitFor();
    const anchorButton = page.getByRole("button", { name: "评论此段", exact: true }).first();
    if (await anchorButton.count()) {
      await anchorButton.click();
      await page.getByText("评论此段", { exact: true }).last().waitFor();
    }
    const composer = page.getByRole("textbox", { name: "评论内容" });
    await composer.fill("匿名评论应先要求登录");
    await page.getByRole("button", { name: "发布评论" }).click();
    await page.getByRole("heading", { name: "登录开放知识平台" }).waitFor();
    await page.keyboard.press("Escape");
  });

  await check("E2E-ASSISTANT-001", async () => {
    const composer = page.locator(".assistant-input textarea");
    await composer.fill("@");
    await page.getByRole("button", { name: "官方资料.pdf", exact: true }).last().waitFor();
    await page.getByRole("button", { name: "官方资料.pdf", exact: true }).last().click();
    assert.match(await composer.inputValue(), /@官方资料\.pdf/);
    const dropTarget = page.locator(".assistant-input");
    await dropTarget.evaluate((element) => {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(new File(["e2e"], "notes.txt", { type: "text/plain" }));
      element.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer }));
    });
    await page.getByText("notes.txt", { exact: true }).waitFor();
    await page.getByRole("button", { name: "移除附件notes.txt" }).click();
    await page.getByRole("button", { name: "新对话" }).click();
    await page.getByRole("status").filter({ hasText: "已新建空白对话" }).waitFor();
  });

  await check("E2E-ASSISTANT-002", async () => {
    await page.getByRole("button", { name: "历史对话" }).click();
    await page.getByRole("heading", { name: "历史对话" }).waitFor();
    await page.getByText("登录后可在这里搜索历史对话。", { exact: true }).waitFor();
  });

  await check("E2E-AUTHOR-001", async () => {
    await page.goto(`${baseUrl}/u/yu-research`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Yu" }).waitFor();
    await page.getByRole("heading", { name: "公开项目" }).waitFor();
    await page.getByRole("button", { name: "关注" }).click();
    await page.getByRole("heading", { name: "登录开放知识平台" }).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /打开慧策掌上先机/ }).click();
    await page.getByRole("heading", { name: /慧策掌上先机/ }).waitFor();
  });

  await check("E2E-MOBILE-001", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: "domcontentloaded" });
    const metrics = await page.evaluate(() => ({ innerWidth: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    assert.ok(metrics.scrollWidth <= metrics.innerWidth, JSON.stringify(metrics));
  });

  console.log(JSON.stringify({ baseUrl, checks }, null, 2));
} finally {
  await browser.close();
}
