"use client";

import { FilePlus2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const MAX_TITLE_LENGTH = 160;
const MAX_TEXT_LENGTH = 120_000;

interface AddTextSourceDialogProps {
  open: boolean;
  reportTitle: string | null;
  onClose: () => void;
  onImport: (input: { title: string; text: string }) => Promise<void>;
}

/**
 * 为当前报告粘贴一份可追溯文本资料。
 * 该对话框不提供 URL、文件或自动抓取入口，避免用户误以为内容来自未受控的外部系统。
 */
export function AddTextSourceDialog({ open, reportTitle, onClose, onImport }: AddTextSourceDialogProps) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setText("");
    setError("");
    setSubmitting(false);
    window.setTimeout(() => titleRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !submitting) onClose();
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        const form = document.getElementById("add-text-source-form") as HTMLFormElement | null;
        form?.requestSubmit();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open, submitting]);

  if (!open) return null;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedTitle = title.trim();
    const normalizedText = text.trim();
    if (!normalizedTitle || !normalizedText) {
      setError(!normalizedTitle ? "请填写资料标题。" : "请粘贴需要保留的资料正文。");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      await onImport({ title: normalizedTitle, text: normalizedText });
      onClose();
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "资料未能保存，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  return <div className="dialog-backdrop" role="presentation" onMouseDown={() => !submitting && onClose()}>
    <section className="research-dialog source-import-dialog" role="dialog" aria-modal="true" aria-labelledby="add-source-title" aria-describedby="add-source-description" onMouseDown={(event) => event.stopPropagation()}>
      <header>
        <div className="dialog-icon"><FilePlus2 size={19} aria-hidden="true" /></div>
        <div><h2 id="add-source-title">添加文本资料</h2><p id="add-source-description">资料会保存到“{reportTitle ?? "当前报告"}”并拆分为可检索片段。</p></div>
        <button type="button" onClick={onClose} disabled={submitting} aria-label="关闭添加资料对话框"><X size={18} aria-hidden="true" /></button>
      </header>
      <form id="add-text-source-form" onSubmit={submit}>
        <label htmlFor="source-title">资料标题<input ref={titleRef} id="source-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={MAX_TITLE_LENGTH} aria-invalid={Boolean(error && !title.trim())} aria-describedby="source-title-help" placeholder="例如：慧策 2026 年行业访谈摘录" disabled={submitting} /></label>
        <p id="source-title-help" className="field-help">请写明资料名称或来源语境，便于后续检索和引用。</p>
        <label htmlFor="source-text">资料正文<textarea id="source-text" value={text} onChange={(event) => setText(event.target.value)} maxLength={MAX_TEXT_LENGTH} aria-invalid={Boolean(error && !text.trim())} aria-describedby="source-text-help source-import-error" placeholder="粘贴你有权保存和分析的正文内容…" rows={12} disabled={submitting} /></label>
        <div className="source-import-meta"><p id="source-text-help">仅支持手动粘贴文本。不会访问 URL、文件或外部系统。</p><span className="mono">{text.length.toLocaleString("zh-CN")} / {MAX_TEXT_LENGTH.toLocaleString("zh-CN")}</span></div>
        {error ? <p id="source-import-error" className="form-error" role="alert" aria-live="polite">{error}</p> : null}
        <footer><button type="button" className="button button--quiet" onClick={onClose} disabled={submitting}>取消</button><button type="submit" className="button button--primary" disabled={submitting}>{submitting ? "正在保存…" : "保存资料"}</button></footer>
      </form>
    </section>
  </div>;
}
