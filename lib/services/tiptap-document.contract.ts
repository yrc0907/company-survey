import assert from "node:assert/strict";
import { contentToTiptap, tiptapToMarkdown } from "./tiptap-document";

const document = contentToTiptap("# 标题\n\n正文段落", "section-a");
assert.equal(document.content?.[0]?.attrs?.blockId, "section-a:block:1", "旧正文导入必须生成确定性块 ID");
assert.match(tiptapToMarkdown(document), /# 标题[\s\S]*正文段落/, "TipTap 文档必须可导出为 Markdown");
console.log("tiptap document contract passed");
