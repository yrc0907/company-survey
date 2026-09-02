import type { JSONContent } from "@tiptap/react";

/** 将旧的纯文本章节转换为带稳定 blockId 的 TipTap 文档。 */
export function contentToTiptap(content: string, sectionId: string): JSONContent {
  const lines = content.split(/\r?\n/);
  const blocks: JSONContent[] = [];
  let paragraph: string[] = [];
  const flush = () => { if (paragraph.length) { blocks.push({ type: "paragraph", content: [{ type: "text", text: paragraph.join(" ").trim() }] }); paragraph = []; } };
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { flush(); continue; }
    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (heading) { flush(); blocks.push({ type: "heading", attrs: { level: heading[1]!.length }, content: [{ type: "text", text: heading[2]! }] }); continue; }
    if (trimmed.startsWith("> ")) { flush(); blocks.push({ type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: trimmed.slice(2) }] }] }); continue; }
    if (/^[-*]\s+/.test(trimmed)) { flush(); blocks.push({ type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: trimmed.slice(2) }] }] }] }); continue; }
    paragraph.push(trimmed);
  }
  flush();
  const withIds = blocks.length ? blocks : [{ type: "paragraph", content: undefined }];
  return { type: "doc", content: withIds.map((block, index) => ({ ...block, attrs: { ...(block.attrs ?? {}), blockId: `${sectionId}:block:${index + 1}` } })) };
}

/** 从 TipTap JSON 导出兼容报告检索的 Markdown 文本，并保留块之间的稳定换行语义。 */
export function tiptapToMarkdown(document: JSONContent): string {
  const render = (node: JSONContent): string => {
    if (node.type === "text") return node.text ?? "";
    const inner = (node.content ?? []).map(render).join("");
    if (node.type === "heading") return `${"#".repeat(Math.max(1, Number(node.attrs?.level) || 1))} ${inner}`;
    if (node.type === "blockquote") return inner.split("\n").map((line) => `> ${line}`).join("\n");
    if (node.type === "bulletList") return (node.content ?? []).map((item) => `- ${render(item)}`).join("\n");
    if (node.type === "orderedList") return (node.content ?? []).map((item, index) => `${index + 1}. ${render(item)}`).join("\n");
    if (node.type === "listItem") return inner;
    if (node.type === "codeBlock") return "```\n" + inner + "\n```";
    return inner;
  };
  return (document.content ?? []).map(render).join("\n\n").trim();
}
