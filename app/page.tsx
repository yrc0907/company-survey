"use client";

import { useEffect, useState } from "react";

import { LoginGateDialog } from "@/components/platform/login-gate-dialog";
import { ProjectWorkspace } from "@/components/platform/project-workspace";
import { PublicHome } from "@/components/platform/public-home";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getSeedProject, seedProjects } from "@/lib/ui/platform-seed";
import { adaptPublicProject, adaptPublicProjects } from "@/lib/ui/platform-api";

type LoginIntent = "login" | "create" | "upload" | "contribute";

type RequestState = "idle" | "loading" | "ready" | "error";

/** 页面层只编排公开列表、项目壳与登录门槛；网络响应先经过 typed UI adapter。 */
export default function HomePage() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [commentId, setCommentId] = useState<string | null>(null);
  const [initialTab, setInitialTab] = useState<"changes" | null>(null);
  const [changeId, setChangeId] = useState<string | null>(null);
  const [projects, setProjects] = useState(seedProjects);
  const [listState, setListState] = useState<RequestState>("loading");
  const [listError, setListError] = useState("");
  const [project, setProject] = useState<ReturnType<typeof getSeedProject>>();
  const [projectState, setProjectState] = useState<RequestState>("idle");
  const [projectError, setProjectError] = useState("");
  const [loginDialog, setLoginDialog] = useState<{ open: boolean; intent: LoginIntent }>({ open: false, intent: "login" });

  useEffect(() => {
    let cancelled = false;
    async function loadProjects() {
      setListState("loading");
      setListError("");
      try {
        const response = await fetch("/api/platform/projects?limit=100", { headers: { accept: "application/json" }, cache: "no-store" });
        const payload = await response.json() as { projects?: unknown[]; error?: string };
        if (!response.ok) throw new Error(payload.error || "公开项目列表读取失败");
        if (!cancelled) { setProjects(adaptPublicProjects(payload.projects ?? [])); setListState("ready"); }
      } catch (error) {
        if (!cancelled) { setProjects(seedProjects); setListError(error instanceof Error ? error.message : "公开项目列表读取失败"); setListState("error"); }
      }
    }
    void loadProjects();
    const currentProject = new URLSearchParams(window.location.search).get("project");
    if (currentProject) setProjectId(currentProject);
    const initialParams = new URLSearchParams(window.location.search);
    setCommentId(initialParams.get("comment"));
    setInitialTab(initialParams.get("tab") === "changes" ? "changes" : null);
    setChangeId(initialParams.get("change"));
    const onPopState = () => { const params = new URLSearchParams(window.location.search); setProjectId(params.get("project")); setCommentId(params.get("comment")); setInitialTab(params.get("tab") === "changes" ? "changes" : null); setChangeId(params.get("change")); };
    window.addEventListener("popstate", onPopState);
    return () => { cancelled = true; window.removeEventListener("popstate", onPopState); };
  }, []);

  useEffect(() => {
    if (!projectId) { setProject(undefined); setProjectState("idle"); setProjectError(""); return; }
    const currentProjectId = projectId;
    let cancelled = false;
    const seed = getSeedProject(currentProjectId);
    setProject(undefined);
    async function loadProject() {
      setProjectState("loading");
      setProjectError("");
      try {
        let response = await fetch(`/api/platform/projects/${encodeURIComponent(currentProjectId)}`, { headers: { accept: "application/json" }, cache: "no-store" });
        // 上传创建的是 private/draft 项目；只有 owner 的 Session 可以通过 /me 读取。
        if (response.status === 404) response = await fetch(`/api/platform/me/projects/${encodeURIComponent(currentProjectId)}`, { headers: { accept: "application/json" }, cache: "no-store" });
        const payload = await response.json() as { project?: unknown; error?: string };
        if (!response.ok) throw new Error(payload.error || "公开项目读取失败");
        const adapted = adaptPublicProject(payload.project);
        if (!adapted) throw new Error("项目响应格式无效");
        if (!cancelled) { setProject(adapted); setProjectState("ready"); }
      } catch (error) {
        if (!cancelled) {
          if (seed) { setProject(seed); setProjectState("error"); setProjectError("线上详情暂不可用，当前显示首发内容。"); }
          else { setProject(undefined); setProjectState("error"); setProjectError(error instanceof Error ? error.message : "公开项目读取失败"); }
        }
      }
    }
    void loadProject();
    return () => { cancelled = true; };
  }, [projectId]);

  function openProject(nextProjectId: string) {
    setProjectId(nextProjectId);
    setCommentId(null);
    setInitialTab(null);
    setChangeId(null);
    const url = new URL(window.location.href);
    url.searchParams.set("project", nextProjectId);
    url.searchParams.delete("comment");
    url.searchParams.delete("tab");
    url.searchParams.delete("change");
    window.history.pushState({}, "", url);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function closeProject() {
    setProjectId(null);
    setCommentId(null);
    setInitialTab(null);
    setChangeId(null);
    setProject(undefined);
    const url = new URL(window.location.href);
    url.searchParams.delete("project");
    url.searchParams.delete("comment");
    url.searchParams.delete("tab");
    url.searchParams.delete("change");
    window.history.pushState({}, "", url);
  }

  function requireLogin(intent: LoginIntent) {
    setLoginDialog({ open: true, intent });
  }

  return (
    <>
      {projectId && (projectState === "loading" || project) ? project ? <ProjectWorkspace project={project} onBack={closeProject} onRequireLogin={requireLogin} initialCommentId={commentId} initialTab={initialTab} initialChangeId={changeId} /> : <main className="route-state route-state--loading" aria-live="polite" aria-busy="true"><Skeleton className="h-3 w-72" /><Skeleton className="h-3 w-48" /><p>正在读取公开项目…</p></main> : projectId ? <main className="route-state" role="alert"><h1>无法打开这个项目</h1><p>{projectError || "公开项目不存在或已下架。"}</p><Button variant="outline" onClick={closeProject}>返回项目列表</Button></main> : <PublicHome projects={projects} loading={listState === "loading"} error={listError} onRetry={() => window.location.reload()} onOpenProject={openProject} onRequireLogin={requireLogin} />}
      <LoginGateDialog open={loginDialog.open} intent={loginDialog.intent} onOpenChange={(open) => setLoginDialog((current) => ({ ...current, open }))} />
    </>
  );
}
