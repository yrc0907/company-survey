"use client";

import { ArrowLeft, BookOpen, CalendarDays, FolderGit2, GitCommitHorizontal, Loader2, Users, UserPlus, UserRoundCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { LoginGateDialog } from "@/components/platform/login-gate-dialog";
import { ProjectCard } from "@/components/platform/project-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/ui/avatar";
import { adaptPublicProjects } from "@/lib/ui/platform-api";
import type { SeedProject } from "@/lib/ui/platform-seed";

interface AuthorProfileData {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  avatarAssetId: string | null;
  createdAt: string;
  projectCount: number;
  followerCount: number;
  followingCount: number;
  followedByCurrentUser: boolean;
  projects: SeedProject[];
  contributions: Array<{ id: string; project: { id: string; title: string }; blockId: string; nodeId: string; createdAt: string; mergeRequestId: string | null }>;
  activity: Array<{ day: string; totalCount: number; events: Array<{ eventType: string; count: number; project: { id: string; slug: string; title: string } | null }> }>;
}

type RequestState = "loading" | "ready" | "error";
type FollowState = "loading" | "ready" | "saving" | "error";

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

const activityLabels: Record<string, string> = { project_created: "创建项目", commit_created: "提交版本", merge_request_opened: "发起修改申请", merge_request_merged: "合并修改申请", review_submitted: "提交审核", comment_created: "发表评论", project_starred: "收藏项目", project_unstarred: "取消收藏项目" };

/** API 响应仅经过此适配器进入作者页，避免不可信 JSON 直接驱动 JSX。 */
function adaptAuthor(value: unknown): AuthorProfileData | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const id = text(source.id);
  const username = text(source.username);
  if (!id || !username) return null;
  return {
    id,
    username,
    displayName: text(source.displayName, username),
    bio: text(source.bio),
    avatarAssetId: typeof source.avatarAssetId === "string" ? source.avatarAssetId : null,
    createdAt: text(source.createdAt, new Date(0).toISOString()),
    projectCount: number(source.projectCount),
    followerCount: number(source.followerCount),
    followingCount: number(source.followingCount),
    followedByCurrentUser: source.followedByCurrentUser === true,
    projects: adaptPublicProjects(source.projects),
    contributions: Array.isArray(source.contributions) ? source.contributions.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>; const project = row.project;
      if (!project || typeof project !== "object") return [];
      const p = project as Record<string, unknown>; if (typeof row.id !== "string" || typeof row.blockId !== "string" || typeof row.nodeId !== "string" || typeof p.id !== "string" || typeof p.title !== "string") return [];
      return [{ id: row.id, blockId: row.blockId, nodeId: row.nodeId, createdAt: text(row.createdAt), mergeRequestId: typeof row.mergeRequestId === "string" ? row.mergeRequestId : null, project: { id: p.id, title: p.title } }];
    }) : [],
    activity: Array.isArray(source.activity) ? source.activity.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>; if (typeof row.day !== "string") return [];
      const events = Array.isArray(row.events) ? row.events.flatMap((event) => {
        if (!event || typeof event !== "object") return [];
        const e = event as Record<string, unknown>; const project = e.project;
        const projectValue = project && typeof project === "object" && typeof (project as Record<string, unknown>).id === "string" && typeof (project as Record<string, unknown>).title === "string" ? { id: String((project as Record<string, unknown>).id), slug: text((project as Record<string, unknown>).slug), title: String((project as Record<string, unknown>).title) } : null;
        return typeof e.eventType === "string" ? [{ eventType: e.eventType, count: number(e.count), project: projectValue }] : [];
      }) : [];
      return [{ day: row.day, totalCount: number(row.totalCount), events }];
    }) : [],
  };
}

function dateLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "未知" : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short" }).format(date);
}

type AuthorActivityDay = AuthorProfileData["activity"][number];

/** GitHub 风格年度活动图；空数据保持空白，不用虚构热度填充。 */
function AuthorActivityHeatmap({ activity, selectedDay, onSelect }: { activity: AuthorActivityDay[]; selectedDay: string | null; onSelect: (day: string | null) => void }) {
  const byDay = new Map(activity.map((item) => [item.day, item]));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = new Date(today); start.setDate(start.getDate() - 364);
  const leading = start.getDay();
  const dates = Array.from({ length: 365 }, (_, index) => { const date = new Date(start); date.setDate(start.getDate() + index); return date.toISOString().slice(0, 10); });
  const cells: Array<string | null> = [...Array.from({ length: leading }, () => null), ...dates];
  const columns = Math.ceil(cells.length / 7);
  const selected = selectedDay ? byDay.get(selectedDay) : undefined;
  return <div className="grid gap-3"><div className="overflow-x-auto pb-1"><div className="grid min-w-[620px] gap-1" style={{ gridTemplateColumns: `repeat(${columns}, minmax(10px, 1fr))`, gridTemplateRows: "repeat(7, 11px)", gridAutoFlow: "column" }} aria-label="最近 365 天贡献活动"><div className="sr-only">点击活动方块查看当天具体事件</div>{cells.map((day, index) => { if (!day) return <span key={`blank-${index}`} aria-hidden="true" />; const item = byDay.get(day); const count = item?.totalCount ?? 0; const level = count === 0 ? "bg-muted" : count === 1 ? "bg-foreground/25" : count <= 3 ? "bg-foreground/50" : count <= 7 ? "bg-foreground/75" : "bg-foreground"; return <button key={day} type="button" className={`size-[11px] rounded-[2px] ${level} ring-offset-1 transition-transform hover:scale-125 focus-visible:ring-2 focus-visible:ring-ring ${selectedDay === day ? "ring-2 ring-foreground" : ""}`} title={`${day} · ${count} 次活动`} aria-label={`${day}，${count} 次活动`} onClick={() => onSelect(selectedDay === day ? null : day)} />; })}</div></div><div className="flex items-center justify-between text-[10px] text-muted-foreground"><span>{dates[0]} → {dates.at(-1)}</span><span className="flex items-center gap-1.5">少 <i className="size-2.5 rounded-[2px] bg-muted" /> <i className="size-2.5 rounded-[2px] bg-foreground/50" /> <i className="size-2.5 rounded-[2px] bg-foreground" /> 多</span></div>{selected ? <div className="rounded-lg border bg-muted/20 p-3" aria-live="polite"><div className="flex items-center justify-between gap-3"><strong className="text-sm">{selected.day}</strong><span className="text-xs text-muted-foreground">{selected.totalCount} 次活动</span></div>{selected.events.length ? <ul className="mt-2 grid gap-1.5 text-xs">{selected.events.map((event, index) => <li key={`${event.eventType}-${event.project?.id ?? "global"}-${index}`} className="flex items-center justify-between gap-3"><span>{activityLabels[event.eventType] ?? event.eventType} × {event.count}</span>{event.project ? <a className="max-w-[55%] truncate text-muted-foreground underline hover:text-foreground" href={`/?project=${encodeURIComponent(event.project.id)}`}>{event.project.title}</a> : null}</li>)}</ul> : <p className="mb-0 mt-2 text-xs text-muted-foreground">当天没有可公开展示的事件明细。</p>}</div> : <p className="mb-0 text-xs text-muted-foreground">选择一个日期查看当天发生了什么。</p>}</div>;
}

/**
 * 作者主页垂直切片：公开资料与项目只读，关注动作通过真实 Session/API 写入。
 * 所有网络阶段都保留 loading、error、success 反馈；项目打开沿用公开首页的详情 URL。
 */
export function AuthorProfile({ username }: { username: string }) {
  const [state, setState] = useState<RequestState>("loading");
  const [error, setError] = useState("");
  const [author, setAuthor] = useState<AuthorProfileData | null>(null);
  const [followState, setFollowState] = useState<FollowState>("loading");
  const [following, setFollowing] = useState(false);
  const [followerCount, setFollowerCount] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [loginOpen, setLoginOpen] = useState(false);
  const [selectedActivityDay, setSelectedActivityDay] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setError("");
    setAuthor(null);
    setFollowState("loading");
    void fetch(`/api/platform/authors/${encodeURIComponent(username)}`, { headers: { accept: "application/json" }, cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({})) as { author?: unknown; error?: string };
        if (!response.ok) throw new Error(payload.error ?? "作者主页暂时无法读取");
        const next = adaptAuthor(payload.author);
        if (!next) throw new Error("作者资料响应格式无效");
        if (cancelled) return;
        setAuthor(next);
        setFollowing(next.followedByCurrentUser);
        setFollowerCount(next.followerCount);
        setState("ready");
        setFollowState("ready");
      })
      .catch((requestError: unknown) => {
        if (cancelled) return;
        setState("error");
        setFollowState("error");
        setError(requestError instanceof Error ? requestError.message : "作者主页暂时无法读取");
      });
    return () => { cancelled = true; };
  }, [username]);

  const projectCountLabel = useMemo(() => `${author?.projectCount ?? 0} 个公开项目`, [author?.projectCount]);

  async function toggleFollow(): Promise<void> {
    if (!author) return;
    // 通过轻量 Session 读取决定是否打开登录门槛；服务端仍会再次验证 actor。
    try {
      const sessionResponse = await fetch("/api/platform/account", { headers: { accept: "application/json" }, cache: "no-store" });
      const sessionPayload = await sessionResponse.json().catch(() => ({})) as { account?: unknown };
      if (!sessionResponse.ok || !sessionPayload.account) { setLoginOpen(true); return; }
    } catch {
      setLoginOpen(true);
      return;
    }
    const nextFollowing = !following;
    setFollowState("saving");
    setFeedback("");
    try {
      const response = await fetch(`/api/platform/authors/${encodeURIComponent(author.username)}/follow`, {
        method: nextFollowing ? "POST" : "DELETE",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: "{}",
        credentials: "same-origin",
      });
      const payload = await response.json().catch(() => ({})) as { following?: unknown; followerCount?: unknown; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "关注操作失败");
      setFollowing(payload.following === true);
      setFollowerCount(number(payload.followerCount));
      setFollowState("ready");
      setFeedback(payload.following === true ? "已关注作者" : "已取消关注");
    } catch (requestError) {
      setFollowState("error");
      setFeedback(requestError instanceof Error ? requestError.message : "关注操作失败");
    }
  }

  function openProject(projectId: string): void {
    const url = new URL("/", window.location.origin);
    url.searchParams.set("project", projectId);
    window.location.assign(url.toString());
  }

  return (
    <>
      <div className="author-page">
        <header className="author-page__header">
          <Button variant="ghost" size="sm" onClick={() => window.location.assign("/")}><ArrowLeft size={15} />返回探索</Button>
          <span className="author-page__brand">开放知识平台</span>
          <span />
        </header>
        {state === "loading" ? <main className="author-page__loading" aria-live="polite" aria-busy="true"><Skeleton className="size-20 rounded-full" /><Skeleton className="h-5 w-44" /><Skeleton className="h-3 w-72" /><Skeleton className="h-32 w-full max-w-5xl" /><p>正在读取作者主页…</p></main> : null}
        {state === "error" ? <main className="route-state" role="alert"><h1>作者主页无法打开</h1><p>{error}</p><Button variant="outline" onClick={() => window.location.reload()}>重试</Button></main> : null}
        {state === "ready" && author ? <main className="author-page__layout items-start lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="space-y-4 lg:sticky lg:top-[84px]">
          <section className="author-profile-card rounded-xl border bg-background p-5 shadow-sm" aria-labelledby="author-profile-title">
            <div className="author-profile-card__top"><UserAvatar name={author.displayName} size="lg" /><div className="author-profile-card__identity"><h1 id="author-profile-title">{author.displayName}</h1><p>@{author.username}</p></div><Button variant={following ? "subtle" : "outline"} size="sm" onClick={() => void toggleFollow()} disabled={followState === "saving" || followState === "loading"} aria-pressed={following}>{followState === "saving" ? <Loader2 size={15} className="animate-spin" /> : following ? <UserRoundCheck size={15} /> : <UserPlus size={15} />}{following ? "已关注" : "关注"}</Button></div>
            {author.bio ? <p className="author-profile-card__bio">{author.bio}</p> : <p className="author-profile-card__bio text-muted-foreground">这个作者还没有填写简介。</p>}
            <div className="author-profile-card__meta"><span><CalendarDays size={14} />加入于 {dateLabel(author.createdAt)}</span><span><FolderGit2 size={14} />{projectCountLabel}</span><span><Users size={14} />{followerCount} 位关注者</span><span><BookOpen size={14} />关注 {author.followingCount} 位作者</span></div>
            {feedback ? <p className={followState === "error" ? "author-feedback author-feedback--error" : "author-feedback"} role={followState === "error" ? "alert" : "status"}>{feedback}{followState === "error" ? <button type="button" onClick={() => void toggleFollow()}>重试</button> : null}</p> : null}
          </section>
          <nav aria-label="作者主页导航" className="rounded-xl border bg-background p-2 shadow-sm"><a href="#pinned-projects" className="flex h-9 items-center gap-2 rounded-md bg-muted px-2.5 text-sm font-medium"><FolderGit2 size={15} />概览</a><a href="#author-projects-title" className="flex h-9 items-center gap-2 rounded-md px-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"><BookOpen size={15} />公开项目</a><a href="#author-contributions-title" className="flex h-9 items-center gap-2 rounded-md px-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"><GitCommitHorizontal size={15} />贡献活动</a></nav>
          </aside>
          <div className="min-w-0 space-y-8">
          <section id="pinned-projects" className="rounded-xl border bg-background p-5 shadow-sm sm:p-6"><div className="mb-4 flex items-center justify-between"><div><h2 className="m-0 text-base font-semibold">Pinned 项目</h2><p className="mb-0 mt-1 text-xs text-muted-foreground">作者希望优先展示的公开研究。</p></div><span className="font-mono text-xs text-muted-foreground">{Math.min(author.projects.length, 4)} / 4</span></div>{author.projects.length ? <div className="grid gap-3 sm:grid-cols-2">{author.projects.slice(0, 4).map((project) => <button key={project.id} type="button" onClick={() => openProject(project.id)} className="group rounded-lg border bg-background p-4 text-left transition-[border-color,box-shadow] hover:border-foreground/25 hover:shadow-sm"><span className="flex items-center gap-2"><FolderGit2 size={15} className="text-muted-foreground" /><strong className="truncate text-sm">{project.title}</strong></span><span className="mt-2 block line-clamp-2 text-xs leading-5 text-muted-foreground">{project.summary}</span><span className="mt-3 flex items-center gap-3 text-[11px] text-muted-foreground"><span>{project.category}</span><span>v{project.version}</span><span>{project.uniqueReaders} 阅读</span></span></button>)}</div> : <div className="grid place-items-center gap-2 py-8 text-sm text-muted-foreground"><FolderGit2 size={20} /><p className="m-0">还没有可置顶的公开项目。</p></div>}</section>
          <section className="author-projects" aria-labelledby="author-activity-title"><div className="author-projects__heading"><div><h2 id="author-activity-title">贡献活动</h2><p>每个小方块来自公开活动账本；点击某天查看当天发生的提交、评论、审核或合并。</p></div><span>{author.activity.reduce((sum, item) => sum + item.totalCount, 0)} 次</span></div><AuthorActivityHeatmap activity={author.activity} selectedDay={selectedActivityDay} onSelect={setSelectedActivityDay} /></section>
          <section className="author-projects" aria-labelledby="author-projects-title"><div className="author-projects__heading"><div><h2 id="author-projects-title">公开项目</h2><p>作者维护或发布的公开研究，可直接进入项目详情。</p></div><span>{author.projects.length}</span></div>{author.projects.length ? <div className="author-projects__list">{author.projects.map((project) => <ProjectCard key={project.id} project={project} onOpen={openProject} />)}</div> : <div className="author-projects__empty"><FolderGit2 size={22} /><p>还没有公开项目。</p></div>}</section>
          <section className="author-projects" aria-labelledby="author-contributions-title"><div className="author-projects__heading"><div><h2 id="author-contributions-title">段落贡献历史</h2><p>仅展示已合并到公开项目、仍处于 active 的真实归因。</p></div><span>{author.contributions.length}</span></div>{author.contributions.length ? <ol className="author-contribution-list">{author.contributions.map((item) => <li key={item.id}><strong>{item.project.title}</strong><span>Block {item.blockId}</span><time dateTime={item.createdAt}>{dateLabel(item.createdAt)}</time></li>)}</ol> : <div className="author-projects__empty"><BookOpen size={22} /><p>暂无公开段落贡献。</p></div>}</section>
          </div>
        </main> : null}
      </div>
      <LoginGateDialog open={loginOpen} intent="login" onOpenChange={setLoginOpen} />
    </>
  );
}
