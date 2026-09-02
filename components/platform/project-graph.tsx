"use client";

import { AlertCircle, CheckCircle2, CircleDashed, ExternalLink, Link2, Loader2, Network, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import type { PublicGraph, PublicGraphEdge, PublicGraphNode } from "@/lib/services/graph-service";

interface ProjectGraphProps { projectId: string; }
interface GraphResponse { graph?: unknown; source?: unknown; }
type GraphState = "loading" | "ready" | "error";

const evidenceLabel: Record<PublicGraphNode["evidenceState"], string> = { fact: "事实", inference: "推断", needs_verification: "待核验", conflict: "冲突" };
const evidenceClass: Record<PublicGraphNode["evidenceState"], string> = { fact: "border-foreground/30 bg-foreground/[0.04]", inference: "border-amber-500/40 bg-amber-500/[0.06]", needs_verification: "border-dashed border-muted-foreground/45 bg-muted/30", conflict: "border-red-500/45 bg-red-500/[0.06]" };
const kindLabel: Record<PublicGraphNode["kind"], string> = { company: "企业", product: "产品", industry: "行业", competitor: "竞品", policy: "政策", source: "来源", claim: "结论" };

function isEvidenceState(value: unknown): value is PublicGraphNode["evidenceState"] { return value === "fact" || value === "inference" || value === "needs_verification" || value === "conflict"; }
/** 外部来源地址是不可信输入；图谱详情只允许跳转到 HTTP(S)，避免把 URL 当成脚本入口。 */
function safeSourceUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch { return null; }
}
function parseGraph(value: unknown): PublicGraph | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.reportId !== "string" || !Array.isArray(record.nodes) || !Array.isArray(record.edges) || !Array.isArray(record.pendingEdges)) return null;
  const parseNode = (item: unknown): PublicGraphNode | null => {
    if (!item || typeof item !== "object") return null;
    const node = item as Record<string, unknown>;
    const kinds = ["company", "product", "industry", "competitor", "policy", "source", "claim"] as const;
    if (typeof node.id !== "string" || typeof node.name !== "string" || !kinds.includes(node.kind as typeof kinds[number]) || !isEvidenceState(node.evidenceState)) return null;
    return { id: node.id, kind: node.kind as PublicGraphNode["kind"], name: node.name, evidenceState: node.evidenceState, sourceId: typeof node.sourceId === "string" ? node.sourceId : null, sourceTitle: typeof node.sourceTitle === "string" ? node.sourceTitle : null, sourceUrl: safeSourceUrl(node.sourceUrl), sourceState: typeof node.sourceState === "string" ? node.sourceState as PublicGraphNode["sourceState"] : null };
  };
  const parseEdge = (item: unknown): PublicGraphEdge | null => {
    if (!item || typeof item !== "object") return null;
    const edge = item as Record<string, unknown>;
    if (typeof edge.id !== "string" || typeof edge.fromEntityId !== "string" || typeof edge.toEntityId !== "string" || typeof edge.relation !== "string" || !isEvidenceState(edge.evidenceState)) return null;
    return { id: edge.id, fromEntityId: edge.fromEntityId, toEntityId: edge.toEntityId, relation: edge.relation, evidenceState: edge.evidenceState, sourceId: typeof edge.sourceId === "string" ? edge.sourceId : null, sourceTitle: typeof edge.sourceTitle === "string" ? edge.sourceTitle : null, sourceUrl: safeSourceUrl(edge.sourceUrl), sourceState: typeof edge.sourceState === "string" ? edge.sourceState as PublicGraphEdge["sourceState"] : null };
  };
  const nodes = record.nodes.flatMap((item) => { const parsed = parseNode(item); return parsed ? [parsed] : []; });
  const edges = record.edges.flatMap((item) => { const parsed = parseEdge(item); return parsed ? [parsed] : []; });
  const pendingEdges = record.pendingEdges.flatMap((item) => { const parsed = parseEdge(item); return parsed ? [parsed] : []; });
  return { reportId: record.reportId, nodes, edges, pendingEdges, generatedAt: typeof record.generatedAt === "string" ? record.generatedAt : "", available: record.available === true, note: typeof record.note === "string" ? record.note : "关系图暂无说明。" };
}

function shortId(value: string): string { return value.length > 12 ? `${value.slice(0, 8)}…${value.slice(-3)}` : value; }

/**
 * 公开 GraphRAG-lite 关系图：SVG 仅作为可视化，不承担事实生成。
 * 节点可键盘聚焦并查看来源；待核验关系单独列出，避免与 active 证据连线混淆。
 */
export function ProjectGraph({ projectId }: ProjectGraphProps) {
  const [state, setState] = useState<GraphState>("loading");
  const [error, setError] = useState("");
  const [graph, setGraph] = useState<PublicGraph | null>(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading"); setError("");
    try {
      const response = await fetch(`/api/platform/projects/${encodeURIComponent(projectId)}/graph`, { headers: { accept: "application/json" }, cache: "no-store" });
      const payload = await response.json().catch(() => ({})) as GraphResponse;
      if (!response.ok) throw new Error(typeof payload === "object" && payload && "error" in payload && typeof payload.error === "string" ? payload.error : "关系图暂时无法加载");
      const parsed = parseGraph(payload.graph);
      if (!parsed) throw new Error("关系图响应格式无效");
      setGraph(parsed); setSelectedId(parsed.nodes[0]?.id ?? null); setState("ready");
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "关系图暂时无法加载"); setState("error"); }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const filteredNodes = useMemo(() => {
    if (!graph) return [];
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    return graph.nodes.filter((node) => !normalized || `${node.name} ${node.kind} ${node.sourceTitle ?? ""}`.toLocaleLowerCase("zh-CN").includes(normalized));
  }, [graph, query]);
  const visibleNodeIds = useMemo(() => new Set(filteredNodes.map((node) => node.id)), [filteredNodes]);
  const selected = graph?.nodes.find((node) => node.id === selectedId) ?? filteredNodes[0] ?? null;
  const visibleEdges = useMemo(() => graph?.edges.filter((edge) => visibleNodeIds.has(edge.fromEntityId) && visibleNodeIds.has(edge.toEntityId)) ?? [], [graph, visibleNodeIds]);
  const positions = useMemo(() => {
    const width = 760; const height = 360; const count = Math.max(filteredNodes.length, 1);
    return new Map(filteredNodes.map((node, index) => {
      const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
      const radiusX = Math.min(290, 150 + count * 14); const radiusY = Math.min(130, 90 + count * 6);
      return [node.id, { x: width / 2 + Math.cos(angle) * radiusX, y: height / 2 + Math.sin(angle) * radiusY }];
    }));
  }, [filteredNodes]);

  return <section className="mx-auto w-full max-w-[1080px] px-5 pb-20 pt-8 sm:px-10" aria-labelledby="project-graph-title">
    <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-6"><div><p className="mb-1 text-xs uppercase tracking-[0.14em] text-muted-foreground">GraphRAG-lite · 公开关系投影</p><h1 id="project-graph-title" className="m-0 flex items-center gap-2 text-2xl font-semibold"><Network size={22} aria-hidden="true" />研究关系图</h1><p className="mb-0 mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">从当前企业报告的实体与有来源关系边生成。图谱不会替代正文，也不会把模型候选关系升级成事实。</p></div><Button size="icon" variant="ghost" onClick={() => void load()} disabled={state === "loading"} aria-label="刷新关系图" title="刷新关系图"><RefreshCw size={15} className={state === "loading" ? "animate-spin" : undefined} /></Button></div>
    {state === "loading" ? <div className="grid place-items-center gap-2 py-28 text-sm text-muted-foreground" role="status" aria-live="polite" aria-busy="true"><Loader2 size={22} className="animate-spin" /><span>正在读取实体和关系…</span></div> : null}
    {state === "error" ? <div className="mt-8 flex items-center gap-3 rounded-lg border border-red-500/35 bg-red-500/[0.04] p-4 text-sm" role="alert"><AlertCircle size={18} /><span className="flex-1">{error}</span><Button size="sm" variant="outline" onClick={() => void load()}>重试</Button></div> : null}
    {state === "ready" && graph ? <>
      <div className="mt-6 flex flex-wrap items-center gap-2"><label className="flex min-w-[240px] flex-1 items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm"><Search size={15} className="text-muted-foreground" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索图中实体或来源" aria-label="搜索图中实体或来源" className="min-w-0 flex-1 bg-transparent outline-none" /></label><span className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground">{filteredNodes.length}/{graph.nodes.length} 个实体</span><span className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground">{visibleEdges.length} 条可引用关系</span>{graph.pendingEdges.length ? <span className="rounded-full border border-dashed px-2.5 py-1 text-xs text-muted-foreground">{graph.pendingEdges.length} 条待核验</span> : null}</div>
      <div className="mt-5 rounded-xl border bg-muted/[0.12] p-2 sm:p-4"><svg viewBox="0 0 760 360" className="h-auto min-h-[260px] w-full" role="img" aria-labelledby="project-graph-svg-title project-graph-svg-desc"><title id="project-graph-svg-title">报告实体关系图</title><desc id="project-graph-svg-desc">实线为有 active 来源的关系，虚线区域在下方单独列出待核验关系。</desc><defs><marker id="graph-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" /></marker></defs>{visibleEdges.map((edge) => { const from = positions.get(edge.fromEntityId); const to = positions.get(edge.toEntityId); if (!from || !to) return null; const labelX = (from.x + to.x) / 2; const labelY = (from.y + to.y) / 2 - 5; return <g key={edge.id}><line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="currentColor" strokeOpacity="0.3" markerEnd="url(#graph-arrow)" /><text x={labelX} y={labelY} textAnchor="middle" className="fill-muted-foreground text-[9px]">{edge.relation.length > 12 ? `${edge.relation.slice(0, 11)}…` : edge.relation}</text></g>; })}{filteredNodes.map((node) => { const position = positions.get(node.id); if (!position) return null; const active = selected?.id === node.id; return <g key={node.id} transform={`translate(${position.x},${position.y})`} role="button" tabIndex={0} aria-label={`${node.name}，${kindLabel[node.kind]}，${evidenceLabel[node.evidenceState]}`} onClick={() => setSelectedId(node.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedId(node.id); } }} className="cursor-pointer"><circle r={active ? 32 : 27} fill="var(--background)" stroke="currentColor" strokeWidth={active ? 3 : 1.5} strokeOpacity={active ? 0.9 : 0.42} /><text textAnchor="middle" dominantBaseline="central" className="fill-foreground text-[12px] font-medium">{node.name.length > 8 ? `${node.name.slice(0, 7)}…` : node.name}</text><text y="42" textAnchor="middle" className="fill-muted-foreground text-[9px]">{kindLabel[node.kind]} · {evidenceLabel[node.evidenceState]}</text></g>; })}{filteredNodes.length === 0 ? <text x="380" y="180" textAnchor="middle" className="fill-muted-foreground text-sm">没有匹配的实体</text> : null}</svg></div>
      <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-muted-foreground"><CircleDashed size={14} className="mt-0.5 shrink-0" />{graph.note}</p>
      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]"><div><h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Link2 size={16} />可引用关系 <span className="font-mono text-xs font-normal text-muted-foreground">{visibleEdges.length}</span></h2>{visibleEdges.length ? <div className="grid gap-2">{visibleEdges.map((edge) => { const from = graph.nodes.find((node) => node.id === edge.fromEntityId); const to = graph.nodes.find((node) => node.id === edge.toEntityId); return <button key={edge.id} type="button" className="flex items-center gap-2 rounded-lg border bg-background p-3 text-left text-sm transition-colors hover:bg-muted" onClick={() => setSelectedId(edge.toEntityId)}><span className="min-w-0 flex-1 truncate"><strong>{from?.name ?? shortId(edge.fromEntityId)}</strong><span className="mx-2 text-muted-foreground">{edge.relation}</span><strong>{to?.name ?? shortId(edge.toEntityId)}</strong></span><span className="shrink-0 text-[10px] text-muted-foreground">{evidenceLabel[edge.evidenceState]}</span></button>; })}</div> : <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">当前没有带 active 来源的关系边。</div>}</div><aside className="rounded-xl border bg-background p-4" aria-label="实体详情"><h2 className="mb-3 text-sm font-semibold">实体详情</h2>{selected ? <div className="space-y-3 text-sm"><div><p className="mb-1 text-xs text-muted-foreground">名称</p><p className="m-0 font-medium">{selected.name}</p></div><div><p className="mb-1 text-xs text-muted-foreground">类型</p><p className="m-0">{kindLabel[selected.kind]}</p></div><div><p className="mb-1 text-xs text-muted-foreground">证据状态</p><p className={`m-0 inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs ${evidenceClass[selected.evidenceState]}`}>{selected.evidenceState === "fact" ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}{evidenceLabel[selected.evidenceState]}</p></div><div><p className="mb-1 text-xs text-muted-foreground">来源</p>{selected.sourceTitle ? <p className="m-0 leading-5">{selected.sourceTitle}{selected.sourceState !== "active" ? "（来源待核验）" : ""}{selected.sourceUrl ? <a className="mt-1 block text-xs underline underline-offset-2" href={selected.sourceUrl} target="_blank" rel="noreferrer">打开来源</a> : null}</p> : <p className="m-0 text-muted-foreground">暂无来源，不能作为正式事实。</p>}</div></div> : <p className="m-0 text-sm text-muted-foreground">点击图中实体查看来源和证据状态。</p>}</aside></div>
      {graph.pendingEdges.length ? <details className="mt-6 rounded-xl border border-dashed"><summary className="cursor-pointer px-4 py-3 text-sm font-medium">待核验关系（{graph.pendingEdges.length}）</summary><div className="grid gap-2 border-t p-4">{graph.pendingEdges.map((edge) => { const from = graph.nodes.find((node) => node.id === edge.fromEntityId); const to = graph.nodes.find((node) => node.id === edge.toEntityId); return <div key={edge.id} className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"><span>{from?.name ?? shortId(edge.fromEntityId)}</span><span>— {edge.relation} →</span><span>{to?.name ?? shortId(edge.toEntityId)}</span><span className="rounded-full border px-2 py-0.5 text-[10px]">{edge.sourceTitle ? `来源：${edge.sourceTitle}` : "缺少来源"}</span></div>; })}</div></details> : null}
      <p className="mt-6 text-right text-[11px] text-muted-foreground"><ExternalLink size={12} className="mr-1 inline" />关系图只读；新增或修订关系必须通过草稿、审核与合并流程。</p>
    </> : null}
  </section>;
}
