import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

/** 最小静态交互契约：防止后续 UI 重构时误删拖放、持久化会话和队列控制入口。 */
async function run(): Promise<void> {
  const assistant = await readFile("components/platform/assistant-panel.tsx", "utf8");
  const upload = await readFile("components/platform/upload-panel.tsx", "utf8");
  const tree = await readFile("components/platform/file-tree.tsx", "utf8");
  const workspace = await readFile("components/platform/project-workspace.tsx", "utf8");
  assert.match(assistant, /\/api\/ai\/conversations\?/, "助手必须加载持久化历史");
  assert.match(assistant, /\/api\/ai\/conversations\/\$\{encodeURIComponent\(id\)\}\/messages/, "助手必须追加消息");
  assert.match(assistant, /onDrop=\{onInputDrop\}/, "助手输入框必须支持拖放");
  assert.match(assistant, /referenceCandidates/, "助手必须提供 @ 文件引用候选");
  assert.match(assistant, /citation\.url/, "助手引用必须可点击");
  assert.match(upload, /xhrRef\.current\?\.abort/, "上传必须支持取消");
  assert.match(upload, /\/retry/, "解析队列必须支持重试");
  assert.match(upload, /method: "DELETE"/, "队列项目必须支持移除");
  assert.match(tree, /onDropFiles/, "文件树必须暴露拖放回调");
  assert.match(workspace, /handleTreeDrop/, "工作台必须显示文件树拖放状态");
  console.log("platform interaction contract: passed");
}

void run().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
