import assert from "node:assert/strict";

import { isReportSaveShortcut } from "./report-editor-shortcuts";

/** 快捷键契约：只验证判定规则，不触发真实保存副作用。 */
function runReportEditorShortcutContract(): void {
  assert.equal(isReportSaveShortcut({ key: "s", ctrlKey: true, metaKey: false }), true, "Windows/Linux Ctrl+S 应触发保存");
  assert.equal(isReportSaveShortcut({ key: "S", ctrlKey: false, metaKey: true }), true, "macOS Cmd+S 应触发保存");
  assert.equal(isReportSaveShortcut({ key: "s", ctrlKey: true, metaKey: false, shiftKey: true }), false, "Shift+Ctrl+S 不应覆盖其他快捷键");
  assert.equal(isReportSaveShortcut({ key: "s", ctrlKey: true, metaKey: false, altKey: true }), false, "Alt+Ctrl+S 不应覆盖浏览器快捷键");
  assert.equal(isReportSaveShortcut({ key: "p", ctrlKey: true, metaKey: false }), false, "其他 Ctrl 组合不能误触发保存");
  assert.equal(isReportSaveShortcut({ key: "s", ctrlKey: false, metaKey: false }), false, "无修饰键不能触发保存");
}

runReportEditorShortcutContract();
console.log("report editor shortcut contract passed");
