import type { PublicProjectRecord } from "@/lib/repositories/platform/platform-repository";
import { formatPublicProjectMarkdown } from "@/lib/services/platform/public-project-markdown";

/** PDF 不能把 UTF-8 直接塞进内容流；用 Unicode CJK 字体的 UTF-16BE hex 字符串保持中文可读。 */
function pdfHex(value: string): string {
  const bytes: number[] = [0xfe, 0xff];
  for (const character of Array.from(value)) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0xffff) bytes.push((codePoint >> 8) & 0xff, codePoint & 0xff);
    else {
      const offset = codePoint - 0x10000;
      const high = 0xd800 + (offset >> 10); const low = 0xdc00 + (offset & 0x3ff);
      bytes.push((high >> 8) & 0xff, high & 0xff, (low >> 8) & 0xff, low & 0xff);
    }
  }
  return `<${bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase()}>`;
}

function wrapLine(value: string, width = 42): string[] {
  const characters = Array.from(value.replace(/\t/g, "    "));
  if (!characters.length) return [""];
  const lines: string[] = [];
  for (let index = 0; index < characters.length; index += width) lines.push(characters.slice(index, index + width).join(""));
  return lines;
}

function addObject(objects: string[], value: string): number { objects.push(value); return objects.length; }

/**
 * 生成仅由公开项目投影构成的基础 PDF。字体使用标准 Adobe CJK，不读取 OSS 原件，
 * 也不把评论、私有草稿、邮箱或内部对象键写入导出文件。
 */
export function formatPublicProjectPdf(project: PublicProjectRecord): { content: Uint8Array; filename: string } {
  const markdown = formatPublicProjectMarkdown(project);
  const lines = markdown.content.split("\n").flatMap((line) => wrapLine(line));
  const pages: string[][] = [];
  for (let index = 0; index < lines.length; index += 52) pages.push(lines.slice(index, index + 52));
  if (!pages.length) pages.push(["暂无公开正文"]);

  const objects: string[] = [];
  const catalogId = addObject(objects, "");
  const pagesId = addObject(objects, "");
  const fontId = addObject(objects, "<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [4 0 R] >>");
  // fontId+1 固定为 CJK CIDFont；对象号由上面的顺序决定，便于下方页面引用。
  const cidFontId = addObject(objects, "<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /DW 1000 >>");
  const pageIds: number[] = [];
  for (const pageLines of pages) {
    const commands = ["BT", "/F1 10 Tf", "50 790 Td", "14 TL", ...pageLines.flatMap((line) => [`${pdfHex(line)} Tj`, "T*"]), "ET"].join("\n");
    const streamId = addObject(objects, `<< /Length ${Buffer.byteLength(commands, "ascii")} >>\nstream\n${commands}\nendstream`);
    pageIds.push(addObject(objects, `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${streamId} 0 R >>`));
  }
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  let output = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets: number[] = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(output, "ascii")); output += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xrefOffset = Buffer.byteLength(output, "ascii");
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) output += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  // PDF 头部的二进制标记按 Latin-1 原样写出；若用 UTF-8 编码，xref 偏移会因多字节字符失效。
  return { content: Buffer.from(output, "latin1"), filename: markdown.filename.replace(/\.md$/i, ".pdf") };
}
