"use client";

import { Activity, BookOpenText, ChevronDown, FileText, Filter, FolderGit2, Loader2, LogIn, Plus, Search, Sparkles, Upload, UserRound, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { ProjectCard } from "@/components/platform/project-card";
import { NotificationMenu } from "@/components/platform/notification-menu";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { matchesProjectSearch } from "@/lib/ui/platform-format";
import type { ProjectCategory, SeedProject } from "@/lib/ui/platform-seed";

interface SearchResult {
  kind: "project" | "author" | "document";
  id: string;
  title: string;
  description: string;
  projectId: string | null;
  projectSlug: string | null;
  projectTitle: string | null;
  authorUsername: string | null;
  authorDisplayName: string | null;
}

interface PublicHomeProps {
  projects: SeedProject[];
  onOpenProject: (projectId: string) => void;
  onRequireLogin: (intent: "login" | "create" | "upload") => void;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
}

const categories: Array<"全部" | ProjectCategory> = ["全部", "企业", "政策", "行业", "技术"];

/** 公开首页首屏以内容和搜索为主，不使用营销 Hero 或空占位。 */
export function PublicHome({ projects, onOpenProject, onRequireLogin, loading = false, error = "", onRetry }: PublicHomeProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<(typeof categories)[number]>("全部");
  const [sort, setSort] = useState<"recommended" | "latest" | "read">("recommended");
  const [globalResults, setGlobalResults] = useState<SearchResult[]>([]);
  const [globalSearchState, setGlobalSearchState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function focusSearch(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  useEffect(() => {
    const normalized = query.trim();
    if (normalized.length < 2) {
      setGlobalResults([]);
      setGlobalSearchState("idle");
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setGlobalSearchState("loading");
      try {
        const response = await fetch(`/api/platform/search?q=${encodeURIComponent(normalized)}&limit=24`, { headers: { accept: "application/json" }, cache: "no-store", signal: controller.signal });
        const payload = await response.json() as { results?: unknown[]; error?: string };
        if (!response.ok) throw new Error(payload.error || "全站搜索失败");
        if (!controller.signal.aborted) {
          const next = Array.isArray(payload.results) ? payload.results.filter((item): item is SearchResult => {
            if (!item || typeof item !== "object") return false;
            const value = item as Partial<SearchResult>;
            return (value.kind === "project" || value.kind === "author" || value.kind === "document") && typeof value.id === "string" && typeof value.title === "string";
          }) : [];
          setGlobalResults(next);
          setGlobalSearchState("ready");
        }
      } catch (error) {
        if (!controller.signal.aborted) setGlobalSearchState(error instanceof Error && error.name === "AbortError" ? "idle" : "error");
      }
    }, 220);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query]);

  const visibleProjects = useMemo(() => {
    const filtered = projects.filter((project) => {
      const categoryMatches = category === "全部" || project.category === category;
      return categoryMatches && matchesProjectSearch([project.title, project.summary, project.owner.displayName, ...project.tags], query);
    });
    if (sort === "latest") return [...filtered].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
    if (sort === "read") return [...filtered].sort((left, right) => right.uniqueReaders - left.uniqueReaders);
    return filtered;
  }, [category, projects, query, sort]);

  // 主题只按当前公开项目的真实标签聚合，不制造“热门”点击量或社区行为。
  const topics = useMemo(() => {
    const counts = new Map<string, number>();
    projects.forEach((project) => project.tags.forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1)));
    return Array.from(counts.entries()).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "zh-CN")).slice(0, 6);
  }, [projects]);

  function resetExplore(): void {
    setQuery("");
    setCategory("全部");
    setSort("recommended");
  }

  function searchTopic(topic: string): void {
    setCategory("全部");
    setQuery(topic);
    document.querySelector(".project-feed")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function searchProject(value: string): void {
    setCategory("全部");
    setQuery(value);
    document.querySelector(".project-feed")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function openSearchResult(result: SearchResult): void {
    if (result.kind === "author" && result.authorUsername) {
      window.location.assign(`/u/${encodeURIComponent(result.authorUsername)}`);
      return;
    }
    if (result.projectId) {
      onOpenProject(result.projectId);
      setGlobalResults([]);
    }
  }

  function openFullSearch(): void {
    const normalized = query.trim();
    if (!normalized) return;
    window.location.assign(`/search?q=${encodeURIComponent(normalized)}`);
  }

  function resultIcon(kind: SearchResult["kind"]): JSX.Element {
    if (kind === "author") return <UserRound size={15} aria-hidden="true" />;
    if (kind === "document") return <FileText size={15} aria-hidden="true" />;
    return <BookOpenText size={15} aria-hidden="true" />;
  }

  return (
    <div className="public-home">
      <header className="public-header">
        <button className="platform-brand" type="button" onClick={resetExplore}>
          <span className="platform-brand__mark"><BookOpenText size={19} aria-hidden="true" /></span>
          <span>开源研报</span>
        </button>
        <label className="global-search" htmlFor="global-search-input">
          <Search size={17} aria-hidden="true" />
          <input ref={searchInputRef} id="global-search-input" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") openFullSearch(); }} placeholder="搜索项目、报告、公司、结论或来源" />
          <kbd>Ctrl K</kbd>
        </label>
        {query.trim().length >= 2 ? <div className="global-search-results" role="region" aria-label="全站搜索结果" aria-live="polite">
          {globalSearchState === "loading" ? <div className="global-search-state"><Loader2 size={15} className="animate-spin" aria-hidden="true" />正在搜索公开内容…</div> : null}
          {globalSearchState === "error" ? <div className="global-search-state global-search-state--error">全站搜索暂时不可用，仍可筛选已加载项目。</div> : null}
          {globalSearchState === "ready" && globalResults.length === 0 ? <div className="global-search-state">没有匹配的公开内容</div> : null}
          {globalResults.length > 0 ? <div className="global-search-result-list">{globalResults.map((result) => <button type="button" key={`${result.kind}:${result.id}`} className="global-search-result" onClick={() => openSearchResult(result)}>
            <span className="global-search-result__icon">{resultIcon(result.kind)}</span>
            <span className="global-search-result__body"><strong>{result.title}</strong><small>{result.kind === "author" ? result.description : result.projectTitle ? `${result.projectTitle} · ${result.description}` : result.description}</small></span>
            <span className="global-search-result__kind">{result.kind === "author" ? "作者" : result.kind === "document" ? "文档" : "项目"}</span>
          </button>)}</div> : null}
        </div> : null}
        <nav className="public-nav" aria-label="全站导航">
          <Button variant="ghost" onClick={resetExplore}>探索</Button>
          <Button variant="ghost" onClick={() => window.location.assign("/search")}>搜索</Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="outline"><Plus size={15} />提交研究<ChevronDown size={14} /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onSelect={() => onRequireLogin("create")}><BookOpenText size={16} />创建空白项目</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onRequireLogin("upload")}><Upload size={16} />上传报告创建项目</DropdownMenuItem>
              <DropdownMenuSeparator />
              <div className="px-2 py-1.5 text-xs text-muted-foreground">创建与上传需要登录</div>
            </DropdownMenuContent>
          </DropdownMenu>
          <NotificationMenu />
          <Button variant="ghost" onClick={() => onRequireLogin("login")}><LogIn size={15} />登录</Button>
        </nav>
      </header>

      <main className="public-layout">
        <aside className="explore-sidebar" aria-label="分类筛选">
          <p className="sidebar-label"><Filter size={14} />内容分类</p>
          <div className="category-list">
            {categories.map((item) => <button type="button" key={item} className={category === item ? "is-active" : undefined} onClick={() => setCategory(item)}><span>{item}</span><span>{item === "全部" ? projects.length : projects.filter((project) => project.category === item).length}</span></button>)}
          </div>
          <div className="sidebar-note">
            <Sparkles size={16} aria-hidden="true" />
            <p><strong>开放阅读，受控合并</strong>任何人可以提出修改，只有项目维护者审核后才进入公开版本。</p>
          </div>
        </aside>

        <section className="project-feed" aria-label="公开研究项目">
          <div className="mb-6 overflow-hidden rounded-xl border bg-background shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-5 border-b px-5 py-5 sm:px-6">
              <div className="min-w-0">
                <p className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground"><FolderGit2 size={14} aria-hidden="true" />公开研究空间</p>
                <h1 className="m-0 text-2xl font-semibold tracking-tight sm:text-3xl">探索可追溯的企业与行业研究</h1>
                <p className="mb-0 mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">像浏览 GitHub 项目一样浏览研究报告：查看来源、版本、贡献和讨论，并沿引用回到原文。</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => window.location.assign("/search")}><Search size={15} />全站搜索</Button>
            </div>
            <div className="grid grid-cols-2 divide-x sm:grid-cols-4">
              <div className="px-5 py-4 sm:px-6"><span className="block text-[11px] uppercase tracking-wide text-muted-foreground">公开项目</span><strong className="mt-1 block font-mono text-xl tabular-nums">{projects.length}</strong></div>
              <div className="px-5 py-4 sm:px-6"><span className="block text-[11px] uppercase tracking-wide text-muted-foreground">研究主题</span><strong className="mt-1 block font-mono text-xl tabular-nums">{topics.length}</strong></div>
              <div className="px-5 py-4 sm:px-6"><span className="block text-[11px] uppercase tracking-wide text-muted-foreground">来源记录</span><strong className="mt-1 block font-mono text-xl tabular-nums">{projects.reduce((sum, item) => sum + item.sourceCount, 0)}</strong></div>
              <div className="px-5 py-4 sm:px-6"><span className="block text-[11px] uppercase tracking-wide text-muted-foreground">贡献者</span><strong className="mt-1 block font-mono text-xl tabular-nums">{new Set(projects.flatMap((item) => item.contributors.map((user) => user.id))).size}</strong></div>
            </div>
          </div>
          <div className="feed-tabs">
            <div role="tablist" aria-label="项目排序">
              <button type="button" role="tab" aria-selected={sort === "recommended"} onClick={() => setSort("recommended")}>推荐</button>
              <button type="button" role="tab" aria-selected={sort === "latest"} onClick={() => setSort("latest")}>最近更新</button>
              <button type="button" role="tab" aria-selected={sort === "read"} onClick={() => setSort("read")}>阅读最多</button>
            </div>
            <span>{visibleProjects.length} 个公开项目</span>
          </div>
          {error ? <div className="public-data-notice" role="status"><span>线上项目列表暂时不可用，当前显示首发内容。</span>{onRetry ? <button type="button" onClick={onRetry}>重试</button> : null}</div> : null}
          {loading ? <div className="project-list-loading" aria-live="polite" aria-busy="true"><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-2/3" /><Skeleton className="h-3 w-full" /><p>正在读取公开项目…</p></div> : null}
          <div className="project-list space-y-3" aria-busy={loading}>
            {!loading && visibleProjects.map((project) => <ProjectCard key={project.id} project={project} onOpen={onOpenProject} onSearch={searchProject} />)}
            {!loading && visibleProjects.length === 0 ? <div className="search-empty"><Search size={22} /><h2>没有匹配的公开项目</h2><p>调整关键词或分类后再试。</p></div> : null}
          </div>
        </section>

        <aside className="discovery-rail" aria-label="社区动态">
          <section className="!border-0 !pb-0">
            <div className="rounded-xl border bg-background p-4 shadow-sm">
              <div className="mb-4 flex items-center gap-2 text-sm font-semibold"><Activity size={15} aria-hidden="true" />社区概览</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-muted/60 p-3"><FolderGit2 size={15} className="text-muted-foreground" /><strong className="mt-2 block font-mono text-lg tabular-nums">{projects.length}</strong><span className="text-[11px] text-muted-foreground">公开项目</span></div>
                <div className="rounded-lg bg-muted/60 p-3"><Users size={15} className="text-muted-foreground" /><strong className="mt-2 block font-mono text-lg tabular-nums">{new Set(projects.flatMap((item) => item.contributors.map((user) => user.id))).size}</strong><span className="text-[11px] text-muted-foreground">公开贡献者</span></div>
              </div>
              <p className="mb-0 mt-3 text-[11px] leading-5 text-muted-foreground">统计由公开项目响应实时聚合；没有事件的项目不会显示虚构互动。</p>
            </div>
          </section>
          <section>
            <div className="rail-heading"><span>项目主题</span><button type="button" onClick={resetExplore}>查看全部</button></div>
            <div className="topic-list">
              {topics.length > 0 ? topics.map(([topic, count]) => <button type="button" key={topic} onClick={() => searchTopic(topic)}># {topic} <span>{count} 个项目</span></button>) : <p className="rail-empty">暂无公开主题</p>}
            </div>
          </section>
          <section>
            <div className="rail-heading"><span>最近合并</span></div>
            <p className="rail-empty">暂无已核验的合并活动</p>
          </section>
          <section className="rail-clarification"><strong>资料核验说明</strong><p>每个项目都保留来源、抓取时间和证据状态；待核验内容不会被展示为已确认事实，点击来源可继续回溯原文。</p></section>
        </aside>
      </main>
    </div>
  );
}
