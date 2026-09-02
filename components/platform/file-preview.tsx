"use client";

import { ExternalLink, FileSpreadsheet, FileText, Image as ImageIcon, ScanText } from "lucide-react";

import type { SeedFilePreview } from "@/lib/ui/platform-seed";

const kindLabel: Record<SeedFilePreview["kind"], string> = {
  markdown: "Markdown",
  text: "纯文本",
  pdf: "PDF 文本预览",
  image: "图片",
  spreadsheet: "表格",
  unknown: "文件",
};

function PreviewIcon({ kind }: { kind: SeedFilePreview["kind"] }) {
  if (kind === "image") return <ImageIcon size={15} aria-hidden="true" />;
  if (kind === "spreadsheet") return <FileSpreadsheet size={15} aria-hidden="true" />;
  if (kind === "pdf") return <ScanText size={15} aria-hidden="true" />;
  return <FileText size={15} aria-hidden="true" />;
}

function SpreadsheetPreview({ preview }: { preview: SeedFilePreview }) {
  if (!preview.rows?.length) return <p className="m-0 text-xs text-muted-foreground">{preview.note ?? "表格原件已登记，但还没有公开解析结果。"}</p>;
  const columns = preview.columns?.length ? preview.columns : preview.rows[0].map((_, index) => `列 ${index + 1}`);
  const rows = preview.columns?.length ? preview.rows : preview.rows.slice(1);
  return <div className="max-h-80 overflow-auto rounded-md border"><table className="w-full min-w-[520px] border-collapse text-xs"><thead className="sticky top-0 bg-muted"><tr>{columns.map((column, index) => <th key={`${column}-${index}`} className="border-b px-3 py-2 text-left font-medium">{column || `列 ${index + 1}`}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex} className="even:bg-muted/25">{columns.map((_, columnIndex) => <td key={columnIndex} className="border-b px-3 py-2 align-top">{row[columnIndex] ?? ""}</td>)}</tr>)}</tbody></table></div>;
}

/**
 * 文件详情预览：只渲染服务端公开投影，原件缺失时显示明确状态。
 * PDF/Markdown/TXT 的原文段落由 ProjectDocument 展示；此组件补充格式、来源和表格/图片专用渲染。
 */
export function FilePreview({ preview }: { preview: SeedFilePreview }) {
  const sourceUrl = preview.sourceUrl && /^https?:\/\//i.test(preview.sourceUrl) ? preview.sourceUrl : null;
  // 只有 MIME 或明确的图片扩展名才能作为 img src；普通网页来源仍只提供外链，避免把 HTML 当图片加载。
  const imageUrl = preview.kind === "image" && sourceUrl && (preview.mimeType?.toLocaleLowerCase().startsWith("image/") || /\.(png|jpe?g|webp|gif|svg)(?:[?#].*)?$/i.test(sourceUrl)) ? sourceUrl : null;
  return <aside className="mb-6 rounded-lg border bg-muted/15 p-4" aria-label={`${kindLabel[preview.kind]}预览`}>
    <div className="flex flex-wrap items-center gap-2 text-xs"><span className="inline-flex items-center gap-1 rounded border bg-background px-2 py-1 font-medium"><PreviewIcon kind={preview.kind} />{kindLabel[preview.kind]}</span>{preview.mimeType ? <span className="font-mono text-muted-foreground">{preview.mimeType}</span> : null}{preview.capturedAt ? <span className="text-muted-foreground">采集于 {new Date(preview.capturedAt).toLocaleString("zh-CN")}</span> : null}{sourceUrl ? <a className="ml-auto inline-flex items-center gap-1 text-muted-foreground hover:text-foreground" href={sourceUrl} target="_blank" rel="noreferrer" referrerPolicy="no-referrer">打开来源 <ExternalLink size={13} aria-hidden="true" /></a> : null}</div>
    {preview.kind === "image" && imageUrl ? <div className="mt-3 overflow-hidden rounded-md border bg-background">
      {/* eslint-disable-next-line @next/next/no-img-element -- 来源 URL 动态且不在 next/image 的远端白名单；使用 lazy/no-referrer 限制加载影响。 */}
      <img src={imageUrl} alt="公开来源图片预览" className="max-h-[420px] w-full object-contain" loading="lazy" referrerPolicy="no-referrer" />
    </div> : null}
    {preview.kind === "image" && !imageUrl ? <p className="mb-0 mt-3 text-xs text-muted-foreground">{preview.note ?? "图片原件没有明确的公开图片地址，仅保留来源链接。"}</p> : null}
    {preview.kind === "spreadsheet" ? <div className="mt-3"><SpreadsheetPreview preview={preview} /></div> : null}
    {preview.kind === "pdf" && !preview.text ? <p className="mb-0 mt-3 text-xs text-muted-foreground">{preview.note ?? "PDF 原件没有公开文本解析结果。"}</p> : null}
    {preview.kind === "unknown" ? <p className="mb-0 mt-3 text-xs text-muted-foreground">{preview.note ?? "公开版本没有可识别的预览格式。"}</p> : null}
    {preview.contentHash ? <p className="mb-0 mt-3 truncate font-mono text-[10px] text-muted-foreground" title={preview.contentHash}>内容哈希：{preview.contentHash}</p> : null}
  </aside>;
}
