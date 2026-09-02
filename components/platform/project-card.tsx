"use client";

import { ArrowUpRight, BookOpen, Clock3, GitPullRequest, Library, MessageCircle, Search, Star, Users, X } from "lucide-react";
import { useMemo, useState } from "react";

import { UserAvatar } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { SeedProject } from "@/lib/ui/platform-seed";
import { formatCompactCount } from "@/lib/ui/platform-format";

interface ProjectCardProps {
  project: SeedProject;
  onOpen: (projectId: string) => void;
  onSearch?: (query: string) => void;
  onOpenOwner?: (username: string) => void;
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(new Date(value));
}

/** 首页列表项只展示可解释统计，Seed 核验状态不冒充实时生产数据。 */
export function ProjectCard({ project, onOpen, onSearch, onOpenOwner }: ProjectCardProps) {
  const [contributorQuery, setContributorQuery] = useState("");
  const verificationLabel = project.verification === "verified" ? "Seed 已核验" : "Seed 待核验";
  const visibleContributors = useMemo(() => {
    const normalized = contributorQuery.trim().toLocaleLowerCase("zh-CN");
    if (!normalized) return project.contributors;
    return project.contributors.filter((user) => [user.displayName, user.username].some((value) => value.toLocaleLowerCase("zh-CN").includes(normalized)));
  }, [contributorQuery, project.contributors]);
  function openOwner(): void {
    if (onOpenOwner) { onOpenOwner(project.owner.username); return; }
    if (typeof window !== "undefined") window.location.assign(`/u/${encodeURIComponent(project.owner.username)}`);
  }
  return (
    <article className="project-list-item">
      <div className="project-owner-line">
          <button type="button" className="project-owner-link" onClick={openOwner} aria-label={`查看${project.owner.displayName}的作者主页`}>
          <UserAvatar name={project.owner.displayName} size="sm" />
          <span className="font-medium text-foreground">{project.owner.displayName}</span>
          </button>
          <span>@{project.owner.username}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={project.publishedAt}>发布于 {dateLabel(project.publishedAt)}</time>
          <span className={project.verification === "verified" ? "verification verification--verified" : "verification verification--pending"}>{verificationLabel}</span>
      </div>
      <button className="project-list-main" type="button" onClick={() => onOpen(project.id)} aria-label={`打开${project.title}`}>
        <div className="project-title-row">
          <div>
            <h2>{project.title}</h2>
            <p>{project.summary}</p>
          </div>
          <ArrowUpRight className="project-open-icon" size={18} aria-hidden="true" />
        </div>
      </button>
      <div className="project-tag-row" aria-label="项目标签">{project.tags.map((tag) => <button type="button" key={tag} onClick={() => onSearch?.(tag)}>{tag}</button>)}</div>
      <div className="project-list-footer">
        <div className="project-metrics" aria-label="项目统计">
          <span title="按用户或签名访客逐日去重"><BookOpen size={14} aria-hidden="true" />{formatCompactCount(project.uniqueReaders)} 阅读</span>
          <span><Star size={14} aria-hidden="true" />{formatCompactCount(project.starCount ?? 0)} Star</span>
          {project.commentCount !== undefined ? <span title="未删除的项目级评论"><MessageCircle size={14} aria-hidden="true" />{formatCompactCount(project.commentCount)} 评论</span> : null}
          <span><Users size={14} aria-hidden="true" />{project.contributorCount ?? project.contributors.length} 贡献者</span>
          <span><Library size={14} aria-hidden="true" />{project.sourceCount} 来源</span>
          <span><GitPullRequest size={14} aria-hidden="true" />{project.openMergeRequests} 待审核</span>
          <span><Clock3 size={14} aria-hidden="true" />更新 {dateLabel(project.updatedAt)}</span>
        </div>
        <Dialog onOpenChange={(open) => { if (!open) setContributorQuery(""); }}>
          <DialogTrigger asChild>
            <button type="button" className="contributor-stack" aria-label={`查看${project.contributorCount ?? project.contributors.length} 位贡献者`} title="查看贡献者">
              {project.contributors.slice(0, 4).map((user) => <UserAvatar key={user.id} name={user.displayName} size="sm" />)}
              {project.contributorCount && project.contributorCount > 4 ? <span className="contributor-more">+{project.contributorCount - 4}</span> : project.contributors.length > 4 ? <span className="contributor-more">+{project.contributors.length - 4}</span> : null}
            </button>
          </DialogTrigger>
          <DialogContent className="contributor-dialog">
            <DialogTitle>贡献者</DialogTitle>
            <DialogDescription>{project.title} · {project.contributorCount ?? project.contributors.length} 位公开贡献者</DialogDescription>
            <label className="contributor-search"><Search size={15} aria-hidden="true" /><input value={contributorQuery} onChange={(event) => setContributorQuery(event.target.value)} placeholder="搜索用户名或显示名称" aria-label="搜索贡献者" /><X size={14} className={contributorQuery ? "cursor-pointer" : "invisible"} aria-hidden="true" onClick={() => setContributorQuery("")} /></label>
            <div className="contributor-dialog__list" role="list">
              {visibleContributors.map((user) => <button type="button" key={user.id} className="contributor-dialog__user" onClick={() => { onOpenOwner?.(user.username); if (!onOpenOwner && typeof window !== "undefined") window.location.assign(`/u/${encodeURIComponent(user.username)}`); }}>
                <UserAvatar name={user.displayName} size="md" />
                <span><strong>{user.displayName}</strong><small>@{user.username}</small></span>
                <ArrowUpRight size={15} aria-hidden="true" />
              </button>)}
              {visibleContributors.length === 0 ? <p className="contributor-dialog__empty">没有匹配的贡献者</p> : null}
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <p className="project-verification-note">{project.verificationNote}</p>
    </article>
  );
}
