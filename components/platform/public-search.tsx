"use client";

import { ArrowLeft, ArrowUpRight, BookOpenText, Check, FileText, Filter, Loader2, Search, SlidersHorizontal, UserRound, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/ui/avatar";
import { LoginGateDialog } from "@/components/platform/login-gate-dialog";

type ResultKind = "project" | "author" | "document";

interface SearchResult {
  kind: ResultKind;
  id: string;
  title: string;
  description: string;
  projectId: string | null;
  projectTitle: string | null;
  authorUsername: string | null;
  authorDisplayName: string | null;
  score?: number;
}

type RequestState = "idle" | "loading" | "ready" | "error";

function isResult(value: unknown): value is SearchResult {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<SearchResult>;
  return (item.kind === "project" || item.kind === "author" || item.kind === "document") && typeof item.id === "string" && typeof item.title === "string" && typeof item.description === "string";
}

function kindLabel(kind: ResultKind): string {
  return kind === "project" ? "项目" : kind === "author" ? "作者" : "文档";
}

function kindIcon(kind: ResultKind): JSX.Element {
  if (kind === "author") return <UserRound size={16} aria-hidden="true" />;
  if (kind === "document") return <FileText size={16} aria-hidden="true" />;
  return <BookOpenText size={16} aria-hidden="true" />;
}

/** GitHub 风格的全站搜索页。结果只来自公开 API，加载/错误/空结果均显式呈现。 */
export function PublicSearch({ initialQuery = "" }: { initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [kind, setKind] = useState<ResultKind | "all">("all");
  const [state, setState] = useState<RequestState>(initialQuery.trim() ? "loading" : "idle");
  const [error, setError] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loginOpen, setLoginOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function search(value: string, signal?: AbortSignal): Promise<void> {
    const normalized = value.trim();
    if (!normalized) { setState("idle"); setResults([]); setError(""); return; }
    setState("loading"); setError("");
    try {
      const response = await fetch(`/api/platform/search?q=${encodeURIComponent(normalized)}&limit=100`, { headers: { accept: "application/json" }, cache: "no-store", signal });
      const payload = await response.json().catch(() => ({})) as { results?: unknown[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "搜索暂时不可用");
      if (signal?.aborted) return;
      setResults(Array.isArray(payload.results) ? payload.results.filter(isResult) : []);
      setState("ready");
    } catch (requestError) {
      if (signal?.aborted) return;
      setState("error");
      setError(requestError instanceof Error ? requestError.message : "搜索暂时不可用");
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => { void search(query, controller.signal); }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
    // 搜索词变化才触发请求；search 仅在 effect 中调用，避免额外依赖造成重复请求。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const visibleResults = useMemo(() => kind === "all" ? results : results.filter((item) => item.kind === kind), [kind, results]);
  const counts = useMemo(() => ({ all: results.length, project: results.filter((item) => item.kind === "project").length, author: results.filter((item) => item.kind === "author").length, document: results.filter((item) => item.kind === "document").length }), [results]);

  function openResult(result: SearchResult): void {
    if (result.kind === "author" && result.authorUsername) { window.location.assign(`/u/${encodeURIComponent(result.authorUsername)}`); return; }
    if (result.projectId) { window.location.assign(`/?project=${encodeURIComponent(result.projectId)}`); return; }
  }

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const normalized = query.trim();
    if (normalized) window.history.replaceState({}, "", `/search?q=${encodeURIComponent(normalized)}`);
    void search(normalized);
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-3 px-4 sm:px-6">
          <Button variant="ghost" size="icon" aria-label="返回探索" onClick={() => window.location.assign("/")}><ArrowLeft size={17} /></Button>
          <button type="button" className="flex shrink-0 items-center gap-2 text-sm font-semibold tracking-tight" onClick={() => window.location.assign("/")}><span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground"><BookOpenText size={17} /></span><span className="hidden sm:inline">开放研报</span></button>
          <form className="ml-1 flex h-9 min-w-0 max-w-2xl flex-1 items-center gap-2 rounded-md border bg-muted/45 px-3 transition-colors focus-within:border-ring focus-within:bg-background focus-within:ring-2 focus-within:ring-ring/15" onSubmit={submit}>
            <Search size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" /><input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} aria-label="搜索公开内容" placeholder="搜索项目、作者、文档和来源" className="min-w-0 flex-1 border-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground" /><button type="button" className={query ? "text-muted-foreground hover:text-foreground" : "invisible"} onClick={() => { setQuery(""); inputRef.current?.focus(); }} aria-label="清除搜索"><X size={15} /></button><kbd className="hidden sm:inline">Enter</kbd>
          </form>
          <Button variant="ghost" size="sm" onClick={() => setLoginOpen(true)}>登录</Button>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1440px] gap-7 px-4 py-7 sm:px-6 lg:grid-cols-[220px_minmax(0,1fr)_260px]">
        <aside className="self-start lg:sticky lg:top-[84px]">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-muted-foreground"><Filter size={14} />筛选结果</div>
          <div className="grid gap-1">
            {(["all", "project", "document", "author"] as const).map((item) => <button key={item} type="button" onClick={() => setKind(item === "all" ? "all" : item)} className={`flex h-9 items-center justify-between rounded-md px-2.5 text-left text-sm transition-colors hover:bg-muted ${kind === item ? "bg-secondary font-medium text-secondary-foreground" : "text-muted-foreground"}`} aria-pressed={kind === item}><span>{item === "all" ? "全部" : kindLabel(item)}</span><span className="font-mono text-xs text-muted-foreground">{counts[item]}</span></button>)}
          </div>
          <div className="mt-7 border-t pt-5 text-xs leading-5 text-muted-foreground"><div className="mb-2 flex items-center gap-2 font-semibold text-foreground"><SlidersHorizontal size={14} />搜索范围</div><p className="m-0">仅展示公开项目、公开文档和已发布作者。私有草稿与未合并内容不会出现在结果中。</p></div>
        </aside>

        <section aria-labelledby="search-heading" className="min-w-0">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b pb-5"><div><p className="mb-1 text-xs text-muted-foreground">公开内容搜索</p><h1 id="search-heading" className="m-0 text-2xl font-semibold tracking-tight">{query.trim() ? <>搜索“{query.trim()}”</> : "搜索公开研究"}</h1><p className="mb-0 mt-2 text-sm text-muted-foreground">{state === "ready" ? `${visibleResults.length} 个结果` : "输入关键词查找企业、作者、报告章节或来源"}</p></div>{state === "ready" && visibleResults.length ? <span className="text-xs text-muted-foreground">按相关性排序</span> : null}</div>
          {state === "loading" ? <div className="grid gap-3 py-8" role="status" aria-live="polite" aria-busy="true"><div className="h-20 animate-pulse rounded-lg bg-muted" /><div className="h-20 animate-pulse rounded-lg bg-muted" /><div className="h-20 animate-pulse rounded-lg bg-muted" /><span className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 size={14} className="animate-spin" />正在搜索公开内容…</span></div> : null}
          {state === "error" ? <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-4 text-sm text-amber-900" role="alert"><span className="min-w-0 flex-1">{error}</span><Button size="sm" variant="outline" onClick={() => void search(query)}>重试</Button></div> : null}
          {state === "idle" ? <div className="grid place-items-center gap-2 py-24 text-center text-muted-foreground"><Search size={24} /><h2 className="m-0 text-base font-semibold text-foreground">从一个关键词开始</h2><p className="m-0 text-sm">试试企业名称、行业、作者用户名或报告中的结论。</p></div> : null}
          {state === "ready" && visibleResults.length === 0 ? <div className="grid place-items-center gap-2 py-24 text-center text-muted-foreground"><Search size={24} /><h2 className="m-0 text-base font-semibold text-foreground">没有匹配结果</h2><p className="m-0 text-sm">换一个关键词，或清除左侧筛选条件。</p></div> : null}
          {state === "ready" && visibleResults.length > 0 ? <div className="grid gap-3">{visibleResults.map((result) => <button type="button" key={`${result.kind}:${result.id}`} onClick={() => openResult(result)} className="group flex w-full items-start gap-3 rounded-xl border bg-background p-4 text-left shadow-sm transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-foreground/25 hover:shadow-md"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">{kindIcon(result.kind)}</span><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><strong className="truncate text-sm font-semibold text-foreground">{result.title}</strong><span className="rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground">{kindLabel(result.kind)}</span></span><span className="mt-1 block line-clamp-2 text-xs leading-5 text-muted-foreground">{result.kind === "document" && result.projectTitle ? `${result.projectTitle} · ` : ""}{result.description}</span>{result.authorUsername ? <span className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground"><UserAvatar name={result.authorDisplayName ?? result.authorUsername} size="sm" />@{result.authorUsername}</span> : null}</span><ArrowUpRight size={16} className="mt-1 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" /></button>)}</div> : null}
        </section>

        <aside className="hidden self-start lg:sticky lg:top-[84px] lg:block">
          <div className="rounded-xl border bg-background p-4 shadow-sm"><div className="mb-3 flex items-center gap-2 text-sm font-semibold"><Check size={15} />公开检索</div><p className="m-0 text-xs leading-5 text-muted-foreground">结果由公开内容索引提供。进入项目后可继续按文件、章节和引用定位。</p><div className="mt-4 border-t pt-3 text-[11px] leading-5 text-muted-foreground"><p className="m-0">结果类型</p><div className="mt-2 grid gap-1"><span className="flex justify-between"><span>项目</span><strong className="font-mono">{counts.project}</strong></span><span className="flex justify-between"><span>文档</span><strong className="font-mono">{counts.document}</strong></span><span className="flex justify-between"><span>作者</span><strong className="font-mono">{counts.author}</strong></span></div></div></div>
        </aside>
      </main>
      <LoginGateDialog open={loginOpen} intent="login" onOpenChange={setLoginOpen} />
    </div>
  );
}
