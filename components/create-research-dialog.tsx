"use client";

import { FileText, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { Company } from "./research-types";

interface CreateResearchDialogProps {
  open: boolean;
  companies: Company[];
  activeCompanyId: string | null;
  onClose: () => void;
  onCreateReport: (payload: { title: string; companyId: string }) => Promise<void>;
}

/** 只暴露当前 API 已支持的新建报告操作，提交成功前不在客户端创建假记录。 */
export function CreateResearchDialog({ open, companies, activeCompanyId, onClose, onCreateReport }: CreateResearchDialogProps) {
  const [title, setTitle] = useState("");
  const [companyId, setCompanyId] = useState(activeCompanyId ?? "");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setCompanyId(activeCompanyId ?? companies[0]?.id ?? "");
    setError("");
  }, [open, activeCompanyId, companies]);

  if (!open) return null;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) { setError("请填写报告标题。"); return; }
    if (!companyId) { setError("请先选择研究对象。"); return; }

    setSubmitting(true);
    setError("");
    try {
      await onCreateReport({ title: title.trim(), companyId });
      onClose();
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "创建报告失败，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  return <div className="dialog-backdrop" role="presentation" onMouseDown={() => !submitting && onClose()}>
    <section className="research-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title" onMouseDown={(event) => event.stopPropagation()}>
      <header><div className="dialog-icon"><FileText size={19} aria-hidden="true" /></div><div><h2 id="dialog-title">新建报告</h2><p>报告会建立第一个可回滚版本，正文仍需由你确认后保存。</p></div><button type="button" onClick={onClose} disabled={submitting} aria-label="关闭新建对话框"><X size={18} aria-hidden="true" /></button></header>
      <form onSubmit={submit}>
        <label>报告标题<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：易仓竞品调研" disabled={submitting} /></label>
        <label>归属研究对象<select value={companyId} onChange={(event) => setCompanyId(event.target.value)} disabled={submitting}>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <footer><button type="button" className="button button--quiet" onClick={onClose} disabled={submitting}>取消</button><button type="submit" className="button button--primary" disabled={submitting}>{submitting ? "正在创建…" : "创建报告"}</button></footer>
      </form>
    </section>
  </div>;
}
