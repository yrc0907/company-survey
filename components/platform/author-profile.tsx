"use client";

import { ArrowLeft, BookOpen, CalendarDays, FolderGit2, Loader2, Users, UserPlus, UserRoundCheck } from "lucide-react";
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
}

type RequestState = "loading" | "ready" | "error";
type FollowState = "loading" | "ready" | "saving" | "error";

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

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
  };
}

function dateLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "未知" : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short" }).format(date);
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
        {state === "ready" && author ? <main className="author-page__layout">
          <section className="author-profile-card" aria-labelledby="author-profile-title">
            <div className="author-profile-card__top"><UserAvatar name={author.displayName} size="lg" /><div className="author-profile-card__identity"><h1 id="author-profile-title">{author.displayName}</h1><p>@{author.username}</p></div><Button variant={following ? "subtle" : "outline"} size="sm" onClick={() => void toggleFollow()} disabled={followState === "saving" || followState === "loading"} aria-pressed={following}>{followState === "saving" ? <Loader2 size={15} className="animate-spin" /> : following ? <UserRoundCheck size={15} /> : <UserPlus size={15} />}{following ? "已关注" : "关注"}</Button></div>
            {author.bio ? <p className="author-profile-card__bio">{author.bio}</p> : <p className="author-profile-card__bio text-muted-foreground">这个作者还没有填写简介。</p>}
            <div className="author-profile-card__meta"><span><CalendarDays size={14} />加入于 {dateLabel(author.createdAt)}</span><span><FolderGit2 size={14} />{projectCountLabel}</span><span><Users size={14} />{followerCount} 位关注者</span><span><BookOpen size={14} />关注 {author.followingCount} 位作者</span></div>
            {feedback ? <p className={followState === "error" ? "author-feedback author-feedback--error" : "author-feedback"} role={followState === "error" ? "alert" : "status"}>{feedback}{followState === "error" ? <button type="button" onClick={() => void toggleFollow()}>重试</button> : null}</p> : null}
          </section>
          <section className="author-projects" aria-labelledby="author-projects-title"><div className="author-projects__heading"><div><h2 id="author-projects-title">公开项目</h2><p>作者维护或发布的公开研究，可直接进入项目详情。</p></div><span>{author.projects.length}</span></div>{author.projects.length ? <div className="author-projects__list">{author.projects.map((project) => <ProjectCard key={project.id} project={project} onOpen={openProject} />)}</div> : <div className="author-projects__empty"><FolderGit2 size={22} /><p>还没有公开项目。</p></div>}</section>
          <section className="author-projects" aria-labelledby="author-contributions-title"><div className="author-projects__heading"><div><h2 id="author-contributions-title">段落贡献历史</h2><p>仅展示已合并到公开项目、仍处于 active 的真实归因。</p></div><span>{author.contributions.length}</span></div>{author.contributions.length ? <ol className="author-contribution-list">{author.contributions.map((item) => <li key={item.id}><strong>{item.project.title}</strong><span>Block {item.blockId}</span><time dateTime={item.createdAt}>{dateLabel(item.createdAt)}</time></li>)}</ol> : <div className="author-projects__empty"><BookOpen size={22} /><p>暂无公开段落贡献。</p></div>}</section>
        </main> : null}
      </div>
      <LoginGateDialog open={loginOpen} intent="login" onOpenChange={setLoginOpen} />
    </>
  );
}
