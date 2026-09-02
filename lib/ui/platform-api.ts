import type { PublicProjectRecord } from "@/lib/repositories/platform/platform-repository";

import type { SeedFileNode, SeedProject, SeedSection, SeedUser } from "@/lib/ui/platform-seed";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null ? value as UnknownRecord : null;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function number(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : fallback;
}

function user(value: unknown, fallbackId: string, fallbackName: string): SeedUser {
  const source = record(value);
  const displayName = text(source?.displayName ?? source?.ownerDisplayName, fallbackName);
  const username = text(source?.username ?? source?.ownerUsername, displayName.toLowerCase().replace(/\s+/g, "-") || "researcher");
  return { id: text(source?.id ?? source?.ownerUserId, fallbackId), username, displayName };
}

function kind(value: unknown): SeedFileNode["kind"] {
  return value === "folder" ? "folder" : value === "source" ? "source" : value === "data" ? "data" : "document";
}

interface FlatFile {
  id: string;
  name: string;
  kind: SeedFileNode["kind"];
  parentId: string | null;
  position: number;
}

function files(value: unknown): SeedFileNode[] {
  if (!Array.isArray(value)) return [];
  const flat: FlatFile[] = value.flatMap((entry) => {
    const source = record(entry);
    const id = text(source?.id);
    const name = text(source?.name);
    if (!id || !name) return [];
    return [{ id, name, kind: kind(source?.kind), parentId: typeof source?.parentId === "string" ? source.parentId : null, position: number(source?.position) }];
  });
  const byParent = new Map<string | null, FlatFile[]>();
  for (const item of flat) byParent.set(item.parentId, [...(byParent.get(item.parentId) ?? []), item]);
  const visiting = new Set<string>();
  function build(parentId: string | null): SeedFileNode[] {
    return (byParent.get(parentId) ?? []).sort((left, right) => left.position - right.position || left.name.localeCompare(right.name, "zh-CN")).flatMap((item) => {
      if (visiting.has(item.id)) return [];
      visiting.add(item.id);
      const node: SeedFileNode = { id: item.id, name: item.name, kind: item.kind };
      const children = build(item.id);
      if (children.length) node.children = children;
      return [node];
    });
  }
  return build(null);
}

function sections(value: unknown, owner: SeedUser, updatedAt: string): SeedSection[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    const source = record(entry);
    const heading = text(source?.heading, `研究章节 ${index + 1}`);
    const content = text(source?.content);
    const state = source?.evidenceState === "fact" || source?.evidenceState === "inference" || source?.evidenceState === "conflict" ? source.evidenceState : "needs_verification";
    return [{ id: text(source?.id, `section-${index + 1}`), nodeId: text(source?.nodeId) || undefined, heading, paragraphs: content ? content.split(/\n\s*\n/) : ["该章节暂无公开正文。"], state, contributor: user(source?.contributor, owner.id, owner.displayName), mergeRequest: number(source?.mergeRequest), reviewer: text(source?.reviewer, "待审核"), citations: number(source?.citations) }];
  });
}

/** 将公开 API 的数据库摘要或 typed seed 统一转换为当前三栏 UI 的安全展示模型。 */
export function adaptPublicProject(value: unknown): SeedProject | null {
  const source = record(value);
  if (!source) return null;
  const owner = user(source.owner ?? source, text(source.ownerUserId, "owner"), text(source.ownerDisplayName, "项目维护者"));
  const id = text(source.id);
  const title = text(source.title);
  if (!id || !title) return null;
  const updatedAt = text(source.updatedAt, new Date(0).toISOString());
  const publishedAt = text(source.publishedAt, updatedAt);
  const rawContributors = Array.isArray(source.contributors) ? source.contributors.map((item, index) => user(item, `${owner.id}-contributor-${index}`, `贡献者 ${index + 1}`)) : [];
  const contributorCount = number(source.contributorCount, rawContributors.length || 1);
  return {
    id, slug: text(source.slug, id), title, summary: text(source.summary),
    category: source.category === "企业" || source.category === "政策" || source.category === "技术" ? source.category : "行业",
    tags: Array.isArray(source.tags) ? source.tags.filter((item): item is string => typeof item === "string").slice(0, 20) : [],
    verification: source.verification === "verified" ? "verified" : "needs_verification",
    verificationNote: text(source.verificationNote, "公开项目的核验状态由维护者维护。"), owner,
    publishedAt, updatedAt, uniqueReaders: number(source.uniqueReaders), starCount: number(source.starCount), commentCount: typeof source.commentCount === "number" ? number(source.commentCount) : undefined, contributorCount,
    contributors: rawContributors.length ? rawContributors : [owner], sourceCount: number(source.sourceCount), openMergeRequests: number(source.openMergeRequests),
    version: Math.max(1, number(source.version, 1)), assistantReportId: text(source.assistantReportId) || undefined,
    files: files(source.files), sections: sections(source.sections, owner, updatedAt),
  };
}

export function adaptPublicProjects(value: unknown): SeedProject[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => { const project = adaptPublicProject(item); return project ? [project] : []; });
}

export type { PublicProjectRecord };
