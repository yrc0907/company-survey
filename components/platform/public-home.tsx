"use client";

import { BookOpenText, ChevronDown, Filter, LogIn, Plus, Search, Sparkles, Upload } from "lucide-react";
import { useMemo, useState } from "react";

import { ProjectCard } from "@/components/platform/project-card";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { matchesProjectSearch } from "@/lib/ui/platform-format";
import type { ProjectCategory, SeedProject } from "@/lib/ui/platform-seed";

interface PublicHomeProps {
  projects: SeedProject[];
  onOpenProject: (projectId: string) => void;
  onRequireLogin: (intent: "login" | "create" | "upload") => void;
}

const categories: Array<"全部" | ProjectCategory> = ["全部", "企业", "政策", "行业", "技术"];

/** 公开首页首屏以内容和搜索为主，不使用营销 Hero 或空占位。 */
export function PublicHome({ projects, onOpenProject, onRequireLogin }: PublicHomeProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<(typeof categories)[number]>("全部");
  const [sort, setSort] = useState<"recommended" | "latest" | "read">("recommended");

  const visibleProjects = useMemo(() => {
    const filtered = projects.filter((project) => {
      const categoryMatches = category === "全部" || project.category === category;
      return categoryMatches && matchesProjectSearch([project.title, project.summary, project.owner.displayName, ...project.tags], query);
    });
    if (sort === "latest") return [...filtered].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
    if (sort === "read") return [...filtered].sort((left, right) => right.uniqueReaders - left.uniqueReaders);
    return filtered;
  }, [category, projects, query, sort]);

  return (
    <div className="public-home">
      <header className="public-header">
        <button className="platform-brand" type="button" onClick={() => { setQuery(""); setCategory("全部"); }}>
          <span className="platform-brand__mark"><BookOpenText size={19} aria-hidden="true" /></span>
          <span>开源研报</span>
        </button>
        <label className="global-search" htmlFor="global-search-input">
          <Search size={17} aria-hidden="true" />
          <input id="global-search-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目、报告、公司、结论或来源" />
          <kbd>Ctrl K</kbd>
        </label>
        <nav className="public-nav" aria-label="全站导航">
          <Button variant="ghost">探索</Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="outline"><Plus size={15} />提交研究<ChevronDown size={14} /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onSelect={() => onRequireLogin("create")}><BookOpenText size={16} />创建空白项目</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onRequireLogin("upload")}><Upload size={16} />上传报告创建项目</DropdownMenuItem>
              <DropdownMenuSeparator />
              <div className="px-2 py-1.5 text-xs text-muted-foreground">创建与上传需要登录</div>
            </DropdownMenuContent>
          </DropdownMenu>
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
          <div className="feed-tabs">
            <div role="tablist" aria-label="项目排序">
              <button type="button" role="tab" aria-selected={sort === "recommended"} onClick={() => setSort("recommended")}>推荐</button>
              <button type="button" role="tab" aria-selected={sort === "latest"} onClick={() => setSort("latest")}>最近更新</button>
              <button type="button" role="tab" aria-selected={sort === "read"} onClick={() => setSort("read")}>阅读最多</button>
            </div>
            <span>{visibleProjects.length} 个公开项目</span>
          </div>
          <div className="project-list">
            {visibleProjects.map((project) => <ProjectCard key={project.id} project={project} onOpen={onOpenProject} />)}
            {visibleProjects.length === 0 ? <div className="search-empty"><Search size={22} /><h2>没有匹配的公开项目</h2><p>调整关键词或分类后再试。</p></div> : null}
          </div>
        </section>

        <aside className="discovery-rail" aria-label="社区动态">
          <section>
            <div className="rail-heading"><span>热门主题</span><button type="button">查看全部</button></div>
            <div className="topic-list"><button type="button"># 电商 SaaS <span>18</span></button><button type="button"># 十五五规划 <span>12</span></button><button type="button"># AI 工作流 <span>9</span></button><button type="button"># 跨境电商 <span>8</span></button></div>
          </section>
          <section>
            <div className="rail-heading"><span>最近合并</span></div>
            <div className="merge-activity"><span className="activity-line" /><div><strong>补充政策原文引用</strong><p>陈栩合并到 十五五规划 · 18 分钟前</p></div></div>
            <div className="merge-activity"><span className="activity-line" /><div><strong>修正产品能力边界</strong><p>Yu 合并到 慧策调研 · 2 小时前</p></div></div>
          </section>
          <section className="rail-clarification"><strong>首发内容说明</strong><p>当前页面使用明确标记的 Seed 内容验证信息架构。正式公开前会重新导入有权发布的原始材料并核验引用。</p></section>
        </aside>
      </main>
    </div>
  );
}
