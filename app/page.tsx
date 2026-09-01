"use client";

import { useEffect, useState } from "react";

import { LoginGateDialog } from "@/components/platform/login-gate-dialog";
import { ProjectWorkspace } from "@/components/platform/project-workspace";
import { PublicHome } from "@/components/platform/public-home";
import { getSeedProject, seedProjects } from "@/lib/ui/platform-seed";

type LoginIntent = "login" | "create" | "upload" | "contribute";

/** 页面层只编排公开列表、项目壳与登录门槛；业务数据来自独立 Seed Adapter。 */
export default function HomePage() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [loginDialog, setLoginDialog] = useState<{ open: boolean; intent: LoginIntent }>({ open: false, intent: "login" });
  const project = projectId ? getSeedProject(projectId) : undefined;

  useEffect(() => {
    const currentProject = new URLSearchParams(window.location.search).get("project");
    if (currentProject && getSeedProject(currentProject)) setProjectId(currentProject);
  }, []);

  function openProject(nextProjectId: string) {
    setProjectId(nextProjectId);
    const url = new URL(window.location.href);
    url.searchParams.set("project", nextProjectId);
    window.history.pushState({}, "", url);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function closeProject() {
    setProjectId(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("project");
    window.history.pushState({}, "", url);
  }

  function requireLogin(intent: LoginIntent) {
    setLoginDialog({ open: true, intent });
  }

  return (
    <>
      {project ? <ProjectWorkspace project={project} onBack={closeProject} onRequireLogin={requireLogin} /> : <PublicHome projects={seedProjects} onOpenProject={openProject} onRequireLogin={requireLogin} />}
      <LoginGateDialog open={loginDialog.open} intent={loginDialog.intent} onOpenChange={(open) => setLoginDialog((current) => ({ ...current, open }))} />
    </>
  );
}
