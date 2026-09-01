import { ArrowUpRight, BookOpen, Clock3, GitPullRequest, Library, Star, Users } from "lucide-react";

import { UserAvatar } from "@/components/ui/avatar";
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
  const verificationLabel = project.verification === "verified" ? "Seed 已核验" : "Seed 待核验";
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
          <span><Users size={14} aria-hidden="true" />{project.contributorCount ?? project.contributors.length} 贡献者</span>
          <span><Library size={14} aria-hidden="true" />{project.sourceCount} 来源</span>
          <span><GitPullRequest size={14} aria-hidden="true" />{project.openMergeRequests} 待审核</span>
          <span><Clock3 size={14} aria-hidden="true" />更新 {dateLabel(project.updatedAt)}</span>
        </div>
        <div className="contributor-stack" aria-label={`${project.contributorCount ?? project.contributors.length} 位贡献者`}>
          {project.contributors.slice(0, 4).map((user) => <UserAvatar key={user.id} name={user.displayName} size="sm" />)}
          {project.contributorCount && project.contributorCount > 4 ? <span className="contributor-more">+{project.contributorCount - 4}</span> : project.contributors.length > 4 ? <span className="contributor-more">+{project.contributors.length - 4}</span> : null}
        </div>
      </div>
      <p className="project-verification-note">{project.verificationNote}</p>
    </article>
  );
}
