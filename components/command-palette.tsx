"use client";

import { Building2, FileSearch, FileText, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CommandSearchHit, Company, Report } from "./research-types";

interface CommandPaletteProps {
  open: boolean;
  companies: Company[];
  reports: Report[];
  onClose: () => void;
  onChooseCompany: (id: string) => void;
  onChooseReport: (id: string) => void;
  onChooseSearchHit: (reportId: string, sectionId: string | null) => void;
}

/** 检索 API 的最小响应形状；仅声明前端实际消费的安全字段。 */
interface SearchApiPayload {
  hits?: Array<{
    chunk: { id: string; parentSectionId: string | null; text: string };
    source: { reportId: string; title: string };
    parentSection: { id: string; heading: string } | null;
  }>;
}

/** Cmd/Ctrl+K 优先查询已导入来源；接口失败或空查询时降级为对象和报告的本地元数据搜索。 */
export function CommandPalette({ open, companies, reports, onClose, onChooseCompany, onChooseReport, onChooseSearchHit }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [apiHits, setApiHits] = useState<CommandSearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) window.setTimeout(() => inputRef.current?.focus(), 0); }, [open]);
  useEffect(() => { if (!open) { setQuery(""); setApiHits(null); } }, [open]);
  useEffect(() => {
    const normalized = query.trim();
    if (!normalized) { setApiHits(null); setSearching(false); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const response = await fetch(`/api/research/search?q=${encodeURIComponent(normalized)}`, { signal: controller.signal });
        const payload = await response.json() as SearchApiPayload;
        if (!response.ok) throw new Error("搜索接口不可用");
        setApiHits((payload.hits ?? []).map((hit) => ({
          id: hit.chunk.id,
          reportId: hit.source.reportId,
          sectionId: hit.parentSection?.id ?? hit.chunk.parentSectionId,
          title: hit.parentSection?.heading ?? hit.source.title,
          description: hit.chunk.text,
        })));
      } catch (error) {
        if ((error as { name?: string }).name !== "AbortError") setApiHits(null);
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 220);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [query]);

  const localResults = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    if (!normalized) return { companies: companies.slice(0, 4), reports: reports.slice(0, 4) };
    return {
      companies: companies.filter((company) => `${company.name} ${company.summary} ${company.tags.join(" ")}`.toLocaleLowerCase("zh-CN").includes(normalized)),
      reports: reports.filter((report) => report.title.toLocaleLowerCase("zh-CN").includes(normalized)),
    };
  }, [companies, reports, query]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) { if (event.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  if (!open) return null;
  const hasLocalResults = localResults.companies.length > 0 || localResults.reports.length > 0;
  return <div className="command-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="command-palette" role="dialog" aria-modal="true" aria-label="搜索研究资料" onMouseDown={(event) => event.stopPropagation()}>
      <div className="command-input-row"><Search size={19} aria-hidden="true" /><input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索企业、报告、章节或来源" aria-label="搜索企业、报告、章节或来源" /><button type="button" onClick={onClose} aria-label="关闭搜索"><X size={17} aria-hidden="true" /></button></div>
      <div className="command-results">
        {query.trim() && apiHits ? <><p>已导入资料命中</p>{apiHits.map((hit) => <button type="button" key={hit.id} onClick={() => { onChooseSearchHit(hit.reportId, hit.sectionId); onClose(); }}><FileSearch size={16} aria-hidden="true" /><span>{hit.title}<small>{hit.description}</small></span></button>)}</> : null}
        {searching ? <div className="command-empty">正在检索已导入资料…</div> : null}
        <p>研究对象</p>{localResults.companies.map((company) => <button type="button" key={company.id} onClick={() => { onChooseCompany(company.id); onClose(); }}><Building2 size={16} aria-hidden="true" /><span>{company.name}<small>{company.summary}</small></span></button>)}
        <p>报告</p>{localResults.reports.map((report) => <button type="button" key={report.id} onClick={() => { onChooseReport(report.id); onClose(); }}><FileText size={16} aria-hidden="true" /><span>{report.title}<small>版本 {report.currentVersion}</small></span></button>)}
        {!searching && !hasLocalResults && (!apiHits || apiHits.length === 0) ? <div className="command-empty">没有匹配项。可按标题、企业名、章节或来源文本搜索。</div> : null}
        {!searching && query.trim() && apiHits?.length === 0 ? <div className="command-empty command-empty--compact">当前已导入来源中没有内容命中；仍可打开本地对象或报告结果。</div> : null}
      </div>
      <footer><kbd>Esc</kbd> 关闭 · 来源内容优先调用检索接口，接口不可用时保留本地导航。</footer>
    </section>
  </div>;
}
