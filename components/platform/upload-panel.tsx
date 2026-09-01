"use client";

import { AlertCircle, ArrowLeft, CheckCircle2, FileUp, Loader2, LockKeyhole, RefreshCw, ShieldCheck, UploadCloud, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

type UploadStage = "checking" | "editing" | "creating" | "uploading" | "confirming" | "queued" | "failed";
type UploadPayload = { asset: { id: string; filename: string; expectedSize: number }; upload: { url: string; method: "PUT"; requiredHeaders: Record<string, string> }; ingestion: { id: string; status: string } };
type ProjectPayload = { project: { id: string; title: string } };
type BranchPayload = { branch: { id: string; name: string } };

const ACCEPT = ".md,.txt,.pdf,.docx,.png,.jpg,.jpeg,.webp";
const MAX_BYTES = 25 * 1024 * 1024;

function formatBytes(value: number): string { return value < 1024 * 1024 ? `${Math.ceil(value / 1024)} KB` : `${(value / (1024 * 1024)).toFixed(1)} MB`; }
function slugFromTitle(value: string): string { const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50); return `${/^[a-z0-9][a-z0-9-]*$/.test(slug) ? slug : "research"}-${crypto.randomUUID().slice(0, 8)}`; }
async function sha256(file: File): Promise<string> { const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer()); return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""); }
function contentTypeForFile(file: File): string { if (file.type) return file.type; const extension = file.name.toLowerCase().split(".").pop(); return extension === "md" ? "text/markdown" : extension === "txt" ? "text/plain" : extension === "pdf" ? "application/pdf" : extension === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : extension === "png" ? "image/png" : extension === "jpg" || extension === "jpeg" ? "image/jpeg" : extension === "webp" ? "image/webp" : ""; }

/** 登录后的资料入口：项目、分支、私有 OSS 直传和解析状态均由后端创建与校验。 */
export function UploadPanel() {
  const [stage, setStage] = useState<UploadStage>("checking");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [assetId, setAssetId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState("等待上传");
  const inputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/platform/account", { cache: "no-store" }).then((response) => {
      if (!active) return;
      if (response.status === 401) { window.location.assign(`/login?callbackUrl=${encodeURIComponent("/upload")}&intent=upload`); return; }
      setStage(response.ok ? "editing" : "failed");
      if (!response.ok) setError("无法确认登录状态，请重新登录。");
    }).catch(() => { if (active) { setStage("failed"); setError("无法连接账户服务，请稍后重试。"); } });
    return () => { active = false; };
  }, []);

  const canSubmit = Boolean(title.trim() && file && stage === "editing");
  const stageLabel = useMemo(() => ({ checking: "确认登录状态", editing: "填写项目资料", creating: "创建私人项目", uploading: "上传到私有 OSS", confirming: "校验上传对象", queued: "等待解析任务", failed: "上传失败" } satisfies Record<UploadStage, string>)[stage], [stage]);

  function selectFile(next: File | undefined) {
    setError("");
    setNotice("");
    if (!next) return;
    if (next.size < 1 || next.size > MAX_BYTES) { setError("文件必须在 1 byte 到 25 MiB 之间。"); return; }
    setFile(next);
    setNotice(`${next.name} 已加入上传队列。`);
  }

  function putObject(url: string, headers: Record<string, string>, body: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      xhrRef.current = request;
      request.open("PUT", url);
      Object.entries(headers).forEach(([name, value]) => { if (value) request.setRequestHeader(name, value); });
      request.upload.onprogress = (event) => { if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100)); };
      request.onload = () => {
        xhrRef.current = null;
        if (request.status < 200 || request.status >= 300) { reject(new Error(`OSS 上传失败（${request.status}）`)); return; }
        const etag = request.getResponseHeader("ETag")?.replace(/^"|"$/g, "") ?? "";
        if (!etag) { reject(new Error("OSS 未暴露 ETag，请在 Bucket CORS 中添加 ExposeHeader: ETag 后重试")); return; }
        resolve(etag);
      };
      request.onerror = () => { xhrRef.current = null; reject(new Error("网络中断，OSS 上传失败")); };
      request.onabort = () => { xhrRef.current = null; reject(new Error("上传已取消")); };
      request.send(body);
    });
  }

  async function createProject(): Promise<{ projectId: string; branchId: string }> {
    const projectResponse = await fetch("/api/platform/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: title.trim(), slug: slugFromTitle(title) || undefined, summary: summary.trim() || undefined, visibility: "private" }) });
    const project = await projectResponse.json() as ProjectPayload & { error?: string };
    if (!projectResponse.ok || !project.project?.id) throw new Error(project.error ?? "创建私人项目失败");
    setProjectId(project.project.id);
    const branchResponse = await fetch(`/api/platform/projects/${encodeURIComponent(project.project.id)}/branches`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: `upload-${Date.now().toString(36)}` }) });
    const branch = await branchResponse.json() as BranchPayload & { error?: string };
    if (!branchResponse.ok || !branch.branch?.id) throw new Error(branch.error ?? "创建项目草稿分支失败");
    return { projectId: project.project.id, branchId: branch.branch.id };
  }

  async function upload() {
    if (!file || !title.trim() || stage !== "editing") return;
    setError(""); setNotice(""); setProgress(0); setStage("creating");
    try {
      const hash = await sha256(file);
      const target = await createProject();
      const contentType = contentTypeForFile(file);
      if (!contentType) throw new Error("无法识别文件类型，请选择白名单内的资料格式");
      const intentResponse = await fetch("/api/platform/uploads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ filename: file.name, contentType, size: file.size, sha256: hash, projectId: target.projectId, branchId: target.branchId, clientUploadId: crypto.randomUUID() }) });
      const intent = await intentResponse.json() as UploadPayload & { error?: string };
      if (!intentResponse.ok || !intent.asset?.id) throw new Error(intent.error ?? "创建上传意图失败");
      setAssetId(intent.asset.id); setStage("uploading"); setJobStatus(intent.ingestion.status);
      const etag = await putObject(intent.upload.url, intent.upload.requiredHeaders, file);
      setStage("confirming");
      const completeResponse = await fetch(`/api/platform/uploads/${encodeURIComponent(intent.asset.id)}/complete`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ etag, size: file.size, sha256: hash }) });
      const complete = await completeResponse.json() as { asset?: { id: string }; ingestion?: { status: string }; error?: string };
      if (!completeResponse.ok) throw new Error(complete.error ?? "上传对象校验失败");
      setJobStatus(complete.ingestion?.status ?? "queued"); setStage("queued"); setNotice("上传和完整性校验成功，解析任务已排队。");
    } catch (requestError) {
      setStage("failed"); setNotice(""); setError(requestError instanceof Error ? requestError.message : "上传失败，请稍后重试");
    }
  }

  async function retry() {
    if (!assetId) return;
    setError(""); setStage("confirming");
    try {
      const response = await fetch(`/api/platform/uploads/${encodeURIComponent(assetId)}/retry`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const payload = await response.json() as { ingestion?: { status: string }; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "重试失败");
      setJobStatus(payload.ingestion?.status ?? "queued"); setStage("queued"); setNotice("解析任务已重新加入队列。");
    } catch (requestError) { setStage("failed"); setError(requestError instanceof Error ? requestError.message : "重试失败"); }
  }

  function cancelUpload(): void {
    if (stage !== "uploading") return;
    xhrRef.current?.abort();
    if (assetId) void fetch(`/api/platform/uploads/${encodeURIComponent(assetId)}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => undefined);
    setStage("failed"); setNotice("上传已取消；隔离对象已标记为不可用。"); setError("");
  }
  function removeQueuedFile(): void {
    if (stage === "uploading") { cancelUpload(); return; }
    if (assetId) void fetch(`/api/platform/uploads/${encodeURIComponent(assetId)}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => undefined);
    setFile(null); setAssetId(null); setProjectId(null); setProgress(0); setJobStatus("等待上传"); setError(""); setNotice("队列项已移除，可以重新选择文件。"); setStage("editing");
  }

  return <main className="min-h-screen bg-muted/25 px-4 py-8 text-foreground sm:px-8"><div className="mx-auto max-w-3xl">
    <header className="mb-8 flex items-start justify-between gap-4"><div><Button variant="ghost" size="sm" onClick={() => window.location.assign("/")}><ArrowLeft size={15} />返回公开知识</Button><h1 className="mt-5 text-2xl font-semibold tracking-tight">上传资料，创建私人研究项目</h1><p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">原始文件会先进入私有 OSS 隔离区，校验通过后进入解析队列。项目默认只有你可见。</p></div><span className="hidden items-center gap-1.5 rounded-full border bg-background px-3 py-1.5 text-xs text-muted-foreground sm:inline-flex"><LockKeyhole size={13} />已登录</span></header>
    <section className="rounded-xl border bg-background p-5 shadow-sm sm:p-7"><div className="mb-6 flex items-center gap-3"><span className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary"><UploadCloud size={19} /></span><div><h2 className="text-sm font-semibold">项目资料</h2><p className="text-xs text-muted-foreground">{stageLabel}</p></div><span className="ml-auto font-mono text-xs text-muted-foreground">{file ? `队列 1 项${stage === "uploading" ? ` · ${progress}%` : ""}` : "队列为空"}</span></div>
      <div className="grid gap-5"><label className="grid gap-1.5 text-sm"><span className="font-medium">项目名称</span><input value={title} onChange={(event) => setTitle(event.target.value)} disabled={stage !== "editing"} maxLength={160} className="h-10 rounded-md border bg-background px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60" placeholder="例如：慧策掌上先机产品调研" /></label><label className="grid gap-1.5 text-sm"><span className="font-medium">简介 <span className="font-normal text-muted-foreground">（可选）</span></span><textarea value={summary} onChange={(event) => setSummary(event.target.value)} disabled={stage !== "editing"} maxLength={2000} rows={3} className="resize-none rounded-md border bg-background px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60" placeholder="说明这份研究覆盖什么问题和资料范围" /></label>
        <div className="grid gap-1.5 text-sm"><span className="font-medium">原始资料</span><div className="relative"><button type="button" disabled={stage !== "editing"} onClick={() => inputRef.current?.click()} className="grid min-h-32 w-full place-items-center rounded-lg border border-dashed bg-muted/20 px-4 py-6 text-center transition-colors hover:border-primary/50 hover:bg-primary/5 disabled:pointer-events-none disabled:opacity-60">{file ? <span className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary"><FileUp size={19} /></span><span className="grid text-left"><strong className="max-w-[min(60vw,420px)] truncate text-sm">{file.name}</strong><small className="mt-1 text-xs text-muted-foreground">{formatBytes(file.size)} · {file.type || "未知 MIME"}</small></span></span> : <span className="grid place-items-center gap-2 text-muted-foreground"><FileUp size={22} /><span>点击选择 PDF、DOCX、Markdown、文本或图片</span><small>单文件不超过 25 MiB</small></span>}</button>{file && stage === "editing" ? <button type="button" className="absolute right-2 top-2 rounded border bg-background px-2 py-1 text-xs text-muted-foreground hover:text-foreground" onClick={removeQueuedFile}>移除</button> : null}</div><input ref={inputRef} type="file" accept={ACCEPT} className="sr-only" onChange={(event) => selectFile(event.target.files?.[0])} /></div>
        {stage === "uploading" ? <div className="grid gap-2"><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${progress}%` }} /></div><p className="m-0 text-xs text-muted-foreground">正在使用短期签名地址直传私有 OSS，页面不会接触永久密钥。</p></div> : null}
        {stage === "queued" ? <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 className="mt-0.5 shrink-0" size={17} /><span><strong>上传已确认</strong><small className="mt-1 block text-xs">解析任务状态：{jobStatus}。你可以关闭页面，稍后在项目工作台校对派生文档。</small></span></div> : null}
        {notice ? <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-primary" role="status">{notice}</div> : null}
        {error ? <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert"><AlertCircle className="mt-0.5 shrink-0" size={16} />{error}</div> : null}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5"><p className="m-0 flex items-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck size={14} />上传后仍需在工作台校对，解析器不会覆盖原始证据。</p><div className="flex gap-2">{stage === "uploading" ? <Button variant="outline" onClick={cancelUpload}><X size={15} />取消上传</Button> : null}{stage === "failed" && assetId ? <Button variant="outline" onClick={() => void retry()}><RefreshCw size={15} />重试解析</Button> : null}{stage === "failed" && !assetId ? <Button variant="outline" onClick={removeQueuedFile}>移除并重选</Button> : null}{stage === "queued" ? <Button variant="outline" onClick={removeQueuedFile}>从队列移除</Button> : null}<Button onClick={() => void upload()} disabled={!canSubmit}>{stage === "creating" || stage === "confirming" ? <Loader2 size={15} className="animate-spin" /> : <UploadCloud size={15} />}开始上传</Button></div></div>
      </div></section>
    {projectId ? <div className="mt-4 flex flex-wrap items-center justify-center gap-3 text-xs text-muted-foreground"><span>项目已创建：{projectId}</span><Button variant="outline" size="sm" onClick={() => window.location.assign(`/?project=${encodeURIComponent(projectId)}`)}>打开项目工作台</Button></div> : null}
  </div></main>;
}
