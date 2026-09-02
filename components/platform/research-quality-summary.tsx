"use client";

import { AlertTriangle, CheckCircle2, ClipboardCheck } from "lucide-react";

import type { SeedSection } from "@/lib/ui/platform-seed";

/** 研究质量的可解释投影；只计算页面实际拿到的章节，不把缺失内容补成分数。 */
export function ResearchQualitySummary({ sections, sourceCount }: { sections: SeedSection[]; sourceCount: number }): JSX.Element {
  const usableSections = sections.filter((section) => section.paragraphs.some((paragraph) => paragraph.trim().length > 0));
  const citedSections = usableSections.filter((section) => section.citations > 0);
  const verifiedFacts = usableSections.filter((section) => section.state === "fact").length;
  const pending = usableSections.filter((section) => section.state === "needs_verification" || section.state === "conflict").length;
  const citationCoverage = usableSections.length ? Math.round((citedSections.length / usableSections.length) * 100) : 0;
  const checks = [
    { label: "章节正文", value: `${usableSections.length}/${sections.length}`, ok: sections.length > 0 && usableSections.length === sections.length },
    { label: "引用覆盖", value: `${citationCoverage}%`, ok: citationCoverage >= 80 },
    { label: "公开来源", value: `${sourceCount}`, ok: sourceCount > 0 },
    { label: "待核验", value: `${pending}`, ok: pending === 0 },
  ];
  const ready = checks.filter((check) => check.ok).length;
  return <details className="mt-5 rounded-lg border bg-muted/15" aria-label="研究质量检查"><summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-xs font-medium"><ClipboardCheck size={15} /><span>研究质量检查</span><span className="ml-auto font-mono text-[10px] text-muted-foreground">{ready}/{checks.length} 项通过</span></summary><div className="grid grid-cols-2 gap-2 border-t p-4 sm:grid-cols-4">{checks.map((check) => <div key={check.label} className="rounded-md border bg-background p-2.5"><div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">{check.ok ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}{check.label}</div><strong className="mt-1 block font-mono text-sm tabular-nums">{check.value}</strong></div>)}</div><p className="mb-0 border-t px-4 py-3 text-[10px] leading-5 text-muted-foreground">事实、推断和待核验状态来自每个章节的证据标记；待核验数量不为零时，系统不会把报告显示为“全部已核验”。当前事实章节 {verifiedFacts} 个。</p></details>;
}

