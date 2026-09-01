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
    await page.getByRole("button", { name: "修改申请 3" }).click();
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
