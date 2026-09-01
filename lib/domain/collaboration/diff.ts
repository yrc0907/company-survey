import type { CollaborationConflict, CollaborationDiffEntry, CollaborationNodeSnapshot, CollaborationSnapshot, TextDiffHunk } from "@/lib/domain/collaboration/types";

/** 确定性的逐行 Diff。输入是纯文本，输出顺序稳定，适合审核页面和契约测试。 */
export function diffText(before: string, after: string): TextDiffHunk[] {
  if (before === after) return before ? [{ type: "equal", value: before }] : [];
  const a = before.split("\n");
  const b = after.split("\n");
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) for (let j = b.length - 1; j >= 0; j -= 1) dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const hunks: TextDiffHunk[] = [];
  const push = (type: TextDiffHunk["type"], value: string) => {
    if (!value) return;
    const last = hunks[hunks.length - 1];
    if (last?.type === type) last.value += `${type === "equal" ? "\n" : "\n"}${value}`;
    else hunks.push({ type, value });
  };
  let i = 0; let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { push("equal", a[i]!); i += 1; j += 1; }
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) { push("remove", a[i]!); i += 1; }
    else { push("add", b[j]!); j += 1; }
  }
  while (i < a.length) { push("remove", a[i]!); i += 1; }
  while (j < b.length) { push("add", b[j]!); j += 1; }
  return hunks;
}

function canonical(value: unknown): string {
  return JSON.stringify(value) ?? "";
}

function sameTree(a: CollaborationNodeSnapshot | null, b: CollaborationNodeSnapshot | null): boolean {
  if (!a || !b) return a === b;
  return a.name === b.name && a.parentNodeId === b.parentNodeId && a.position === b.position && a.deleted === b.deleted;
}

function sameContent(a: CollaborationNodeSnapshot | null, b: CollaborationNodeSnapshot | null): boolean {
  if (!a || !b) return a === b;
  return (a.contentHash && b.contentHash) ? a.contentHash === b.contentHash : a.contentText === b.contentText && canonical(a.content) === canonical(b.content);
}

/** 三方比较：只有 source 与 target 同时偏离 base 且结果不同才产生冲突。 */
export function calculateDiff(base: CollaborationSnapshot, source: CollaborationSnapshot, target: CollaborationSnapshot): CollaborationDiffEntry[] {
  const ids = new Set([...Object.keys(base), ...Object.keys(source), ...Object.keys(target)]);
  return Array.from(ids).sort().map((nodeId) => {
    const b = base[nodeId] ?? null; const s = source[nodeId] ?? null; const t = target[nodeId] ?? null;
    const sourceTreeChanged = !sameTree(b, s); const targetTreeChanged = !sameTree(b, t);
    const sourceContentChanged = !sameContent(b, s); const targetContentChanged = !sameContent(b, t);
    if (!sourceTreeChanged && !sourceContentChanged) return { nodeId, operation: "unchanged", base: b, source: s, target: t, conflicts: [] };
    const conflicts: CollaborationConflict[] = [];
    if (sourceTreeChanged && targetTreeChanged && !sameTree(s, t)) {
      conflicts.push({ nodeId, reason: s?.deleted !== t?.deleted ? "deleted" : s?.name !== t?.name ? "renamed" : "moved", base: b?.name ?? "", source: s?.name ?? "<deleted>", target: t?.name ?? "<deleted>", hunks: diffText(b?.name ?? "", s?.name ?? "") });
    }
    if (sourceContentChanged && targetContentChanged && !sameContent(s, t)) {
      conflicts.push({ nodeId, reason: "text", base: b?.contentText ?? "", source: s?.contentText ?? "", target: t?.contentText ?? "", hunks: diffText(t?.contentText ?? "", s?.contentText ?? "") });
    }
    if (conflicts.length) return { nodeId, operation: "conflict", base: b, source: s, target: t, conflicts };
    return { nodeId, operation: s?.deleted ? "delete_node" : b ? (sourceTreeChanged ? (s?.name !== b.name ? "rename_node" : "move_node") : "update_content") : "create_node", base: b, source: s, target: t, conflicts: [] };
  });
}

/** 合并无冲突 Diff；source 没改动的节点保留 target，source 改动的节点覆盖 target。 */
export function applyDiff(entries: CollaborationDiffEntry[]): CollaborationSnapshot {
  const output: CollaborationSnapshot = {};
  for (const entry of entries) {
    if (entry.operation === "conflict") throw new Error("不能应用包含冲突的 Diff");
    const chosen = entry.operation === "unchanged" ? entry.target : entry.source;
    if (chosen) output[entry.nodeId] = chosen;
  }
  return output;
}
