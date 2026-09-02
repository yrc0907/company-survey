import assert from "node:assert/strict";

import { formatPublicProjectPdf } from "@/lib/services/platform/public-project-pdf";
import type { PublicProjectRecord } from "@/lib/repositories/platform/platform-repository";

/** 公开 PDF 导出契约：只接受安全项目投影，输出可识别 PDF 和 UTF-16BE CJK 内容流。 */
function run(): void {
  const project: PublicProjectRecord = {
    id: "project-a", slug: "project-a", title: "企业研究", summary: "公开摘要", visibility: "public", status: "published",
    owner: { id: "user-a", username: "yu", displayName: "Yu", avatarAssetId: null }, publishedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z",
    uniqueReaders: 0, starCount: 0, contributorCount: 1, sourceCount: 1, openMergeRequests: 0, version: 1, license: "cc-by-4.0",
    category: "企业", tags: ["研究"], verification: "needs_verification", files: [], sections: [{ id: "section-a", nodeId: "node-a", heading: "研究判断", content: "这是带有中文的公开正文。", evidenceState: "inference", updatedAt: "2026-01-02T00:00:00.000Z" }],
  };
  const result = formatPublicProjectPdf(project);
  const text = new TextDecoder("latin1").decode(result.content);
  assert.equal(result.filename, "project-a.pdf");
  assert.equal(text.startsWith("%PDF-1.4"), true);
  assert.match(text, /\/Subtype \/Type0/);
  assert.match(text, /\/Encoding \/UniGB-UCS2-H/);
  assert.match(text, /startxref/);
  console.log("public-project-pdf contract: passed");
}

run();
