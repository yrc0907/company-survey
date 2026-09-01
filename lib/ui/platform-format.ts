/** 将统计数压缩为首页可扫描格式，输入无效时稳定降级为 0。 */
export function formatCompactCount(value: number): string {
  const safeValue = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  if (safeValue >= 10_000) return `${(safeValue / 10_000).toFixed(safeValue >= 100_000 ? 0 : 1)}万`;
  if (safeValue >= 1_000) return `${(safeValue / 1_000).toFixed(safeValue >= 10_000 ? 0 : 1)}k`;
  return String(safeValue);
}

/** 默认头像取首个可见字符；空用户名使用中性的“研”字，不请求远程资源。 */
export function avatarInitial(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "研";
}

/** 使用用户名生成稳定色板索引，刷新和跨页面显示保持一致。 */
export function avatarTone(name: string): number {
  let hash = 0;
  for (const character of Array.from(name.trim())) hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  return hash % 6;
}

/** 首页搜索对项目标题、摘要、标签和所有者做确定性匹配。 */
export function matchesProjectSearch(fields: string[], query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase("zh-CN");
  if (!normalized) return true;
  return fields.some((field) => field.toLocaleLowerCase("zh-CN").includes(normalized));
}
