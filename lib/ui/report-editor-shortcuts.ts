/**
 * 判断报告编辑器是否应接管保存快捷键。
 * 输入来自浏览器 KeyboardEvent 的稳定字段；只接受 Ctrl/Cmd+S，避免 Shift/Alt
 * 组合覆盖浏览器或输入法的其他快捷键。
 */
export interface SaveShortcutInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

export function isReportSaveShortcut(input: SaveShortcutInput): boolean {
  return input.key.toLocaleLowerCase() === "s"
    && (input.ctrlKey || input.metaKey)
    && input.altKey !== true
    && input.shiftKey !== true;
}
