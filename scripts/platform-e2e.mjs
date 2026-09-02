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
    // 首页分类、标签和品牌复位都必须有可观察结果，避免按钮只改变内部状态却不更新列表。
    await page.locator(".category-list button").filter({ hasText: "企业" }).click();
    const categoryActive = await page.locator(".category-list button").filter({ hasText: "企业" }).evaluate((element) => element.classList.contains("is-active"));
    assert.equal(categoryActive, true, "企业分类点击后应保持选中状态");
    await page.getByRole("button", { name: "电商 ERP", exact: true }).click();
    assert.equal(await page.getByRole("textbox", { name: "Ctrl K" }).inputValue(), "电商 ERP");
    await page.getByRole("button", { name: "开源研报", exact: true }).click();
    assert.equal(await page.getByRole("textbox", { name: "Ctrl K" }).inputValue(), "");
    await page.getByRole("button", { name: /提交研究/ }).click();
    await page.getByRole("menuitem", { name: "创建空白项目" }).click();
    await page.getByRole("heading", { name: "登录后创建项目" }).waitFor();
    await page.keyboard.press("Escape");
  });

  await check("E2E-HOME-003", async () => {
    const response = await page.request.get(`${baseUrl}/api/platform/search?q=${encodeURIComponent("慧策")}&limit=20`, { headers: { accept: "application/json" } });
    assert.equal(response.status(), 200);
    const body = await response.json();
    assert.ok(Array.isArray(body.results));
    assert.ok(body.results.some((result) => result.kind === "project" && String(result.title).includes("慧策")));
  });

  await check("E2E-HOME-002", async () => {
    // 标签项目数量来自真实数据库，不能把会变化的数字写死在 E2E 定位器中。
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await page.getByRole("region", { name: "公开研究项目" }).waitFor();
    // 首页先用 SSR Seed，再异步替换为 PostgreSQL 投影；等待服务端列表明确结束加载，
    // 避免在 React 替换主题按钮时点击到已脱离 DOM 的旧节点。
    await page.locator('.project-list[aria-busy="false"]').waitFor();
    const topicButton = page.locator(".topic-list button").first();
    await topicButton.waitFor({ state: "visible" });
    const topic = (await topicButton.innerText()).replace(/^#\s*/, "").replace(/\s+\d+\s+个项目$/, "").trim();
    assert.ok(topic.length > 0, "公开主题按钮应包含可搜索的主题文本");
    await topicButton.click();
    await page.waitForFunction((expectedTopic) => document.querySelector("#global-search-input")?.value === expectedTopic, topic);
    assert.equal(await page.getByRole("textbox", { name: "Ctrl K" }).inputValue(), topic, "点击主题后应写入对应搜索关键词");
    await page.keyboard.press("Control+K");
    assert.equal(await page.getByRole("textbox", { name: "Ctrl K" }).evaluate((element) => document.activeElement === element), true);
  });

  await check("E2E-PROJECT-001", async () => {
    await page.getByRole("textbox", { name: "Ctrl K" }).fill("慧策");
    // 全站搜索下拉与项目列表会同时重绘；使用项目主按钮并禁用等待导航，
    // 避免 React 在点击事件同步切换路由时把按钮替换掉，导致 click 一直等待旧节点稳定。
    const projectOpenButton = page.locator(".project-list-main").filter({ hasText: "慧策掌上先机" }).first();
    await projectOpenButton.waitFor({ state: "visible" });
    await projectOpenButton.click({ noWaitAfter: true });
    // 工作台正文标题展示当前文件名（默认“研究结论”），项目标题在身份栏以 slug 展示。
    // 等待工作台壳和 slug，避免把文件标题误当作项目标题造成假失败。
    await page.locator(".project-header").waitFor();
    await page.getByText("huice-commerce-erp", { exact: true }).waitFor();
    assert.match(page.url(), /[?&]project=project-huice(?:&|$)/);
    await page.getByRole("button", { name: "官方资料.pdf", exact: true }).click();
    const activeFile = page.locator(".file-sidebar .tree-node.is-active .tree-node__main");
    await activeFile.filter({ hasText: "官方资料.pdf" }).waitFor();
    assert.equal(await page.locator(".document-heading h1").innerText(), "官方资料.pdf");
    // 文件夹可展开/收起，所有公开文件点击后都要更新选中节点和正文投影。
    // 本地 Seed 与 PostgreSQL 迁移可能使用不同的公开章节命名；从根目录报告文件夹中
    // 找到包含市场章节的节点，再验证同一节点的收起/展开，而不是写死某个旧名称。
    // ContextMenuTrigger 在 DOM 中会包一层 span[data-state]，因此使用稳定的
    // tree-list > span > tree-node 结构，而不是把包装节点误判成文件夹。
    const reportFolders = page.locator(".file-sidebar .tree-list > span > .tree-node").filter({ hasText: "报告" });
    const reportFolderCount = await reportFolders.count();
    let reportFolder = null;
    const marketButton = page.getByRole("button", { name: /市场与竞|市场与竞品/, exact: true }).first();
    for (let index = 0; index < reportFolderCount; index += 1) {
      const candidate = reportFolders.nth(index).locator(".tree-node__main");
      const candidateText = (await candidate.innerText()).trim();
      if (!candidateText.includes("报告")) continue;
      if (await marketButton.isVisible()) {
        reportFolder = candidate;
        break;
      }
      await candidate.click();
      if (await marketButton.isVisible()) {
        reportFolder = candidate;
        break;
      }
    }
    assert.ok(reportFolder && await marketButton.count() > 0, "文件树中应存在包含市场章节的报告文件夹");
    await reportFolder.click();
    await marketButton.waitFor({ state: "hidden" });
    await reportFolder.click();
    await marketButton.waitFor({ state: "visible" });
    const folderNames = new Set((await reportFolders.allTextContents()).map((name) => name.trim()));
    const fileNames = await page.locator(".file-sidebar .tree-node__main").allTextContents();
    for (const fileName of fileNames.filter((name) => !folderNames.has(name.trim()) && !["来源", "数据", "待核验问题"].includes(name.trim()))) {
      const fileButton = page.locator(".file-sidebar .tree-node__main").filter({ hasText: fileName.trim() }).first();
      await fileButton.click();
      await page.locator(".file-sidebar .tree-node.is-active .tree-node__main").filter({ hasText: fileName.trim() }).waitFor();
      assert.ok((await page.locator(".document-heading h1").innerText()).trim().length > 0, `${fileName} 点击后正文标题不能为空`);
    }
    // 根目录加号、文件更多操作和右键菜单都应打开统一命令菜单。
    await page.locator('.file-sidebar .tree-heading button[aria-label="在项目根目录新建"]').click();
    await page.getByRole("menuitem", { name: "新建文档" }).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "官方资料.pdf更多操作" }).click();
    await page.getByRole("menuitem", { name: "打开" }).waitFor();
    await page.keyboard.press("Escape");
    await page.locator(".file-sidebar .tree-node__main").filter({ hasText: "官方资料.pdf" }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "贡献追踪" }).waitFor();
    await page.keyboard.press("Escape");
    // 折叠后出现可操作的恢复按钮，恢复后文件树仍可用。
    await page.getByRole("button", { name: "收起文件树" }).click();
    await page.getByRole("button", { name: "展开文件树" }).click();
    // 申请数量来自真实数据库，不能把本地 seed 的计数写死；只验证入口和面板能打开。
    await page.getByRole("button", { name: /修改申请(?:\s+\d+)?/ }).click();
    await page.getByRole("region", { name: "修改申请" }).waitFor();
  });

  await check("E2E-PROJECT-005", async () => {
    await page.getByRole("button", { name: "内容", exact: true }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出 Markdown", exact: true }).click();
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /\.md$/i);
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
    await page.getByRole("button", { name: "刷新活动时间线" }).click();
    await page.getByRole("button", { name: "问题", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "问题面板将在有可追踪争议后显示" }).waitFor();
    await page.getByRole("button", { name: "贡献者", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "贡献者列表将在首个真实合并后显示" }).waitFor();
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
    await page.getByRole("button", { name: "查看 Diff", exact: true }).first().click();
    await page.getByRole("status").filter({ hasText: "贡献 Diff" }).waitFor();
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
    await page.goto(`${baseUrl}/u/lin-zhixing`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "林知行" }).waitFor();
    await page.getByRole("heading", { name: "公开项目" }).waitFor();
    await page.getByRole("button", { name: "关注" }).click();
    await page.getByRole("heading", { name: "登录开放知识平台" }).waitFor();
    await page.keyboard.press("Escape");
    const authorProjectButton = page.getByRole("button", { name: /打开慧策掌上先机/ });
    await authorProjectButton.waitFor({ state: "visible" });
    await authorProjectButton.click({ noWaitAfter: true });
    await page.locator(".project-header").waitFor();
    await page.getByText("huice-commerce-erp", { exact: true }).waitFor();
  });

  await check("E2E-MOBILE-001", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".project-header").waitFor();
    await page.getByText("huice-commerce-erp", { exact: true }).waitFor();
    // 移动端把文件树和助手收进 Sheet；打开、关闭后仍应保留可访问的内容。
    await page.getByRole("button", { name: "打开文件树" }).click();
    await page.getByRole("heading", { name: "项目文件" }).waitFor();
    await page.keyboard.press("Escape");
    // Radix Sheet 关闭会异步移除 body 滚动锁；等待关闭动画完成后再验证页面滚动。
    await page.locator(".mobile-file-sheet[data-state=\"closed\"]").waitFor({ state: "hidden" }).catch(() => undefined);
    await page.waitForFunction(() => getComputedStyle(document.body).overflow !== "hidden");
    await page.getByRole("button", { name: "打开 AI 助手" }).click();
    await page.getByRole("heading", { name: "AI 研究助手" }).waitFor();
    await page.keyboard.press("Escape");
    await page.locator(".mobile-assistant-sheet[data-state=\"closed\"]").waitFor({ state: "hidden" }).catch(() => undefined);
    await page.waitForFunction(() => getComputedStyle(document.body).overflow !== "hidden");
    const metrics = await page.evaluate(() => ({ innerWidth: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    assert.ok(metrics.scrollWidth <= metrics.innerWidth, JSON.stringify(metrics));
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(80);
    assert.ok(await page.evaluate(() => window.scrollY > 0 || Array.from(document.querySelectorAll<HTMLElement>(".document-pane, .assistant-messages, .file-sidebar")).some((element) => element.scrollTop > 0)), "移动端页面应能实际滚动");
  });

  console.log(JSON.stringify({ baseUrl, checks }, null, 2));
} finally {
  await browser.close();
}
