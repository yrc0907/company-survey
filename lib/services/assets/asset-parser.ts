import { inflateRawSync, inflateSync } from "node:zlib";

import type { AssetRecord } from "@/lib/domain/assets";

/** 解析器允许保留在数据库中的最大文本，避免把二进制或恶意膨胀内容写入检索库。 */
export const MAX_PARSED_TEXT_BYTES = 4 * 1024 * 1024;

export type AssetParserFailureCode =
  | "PARSER_EMPTY_TEXT"
  | "PARSER_INVALID_ENCODING"
  | "PARSER_INVALID_PDF"
  | "PARSER_INVALID_DOCX"
  | "PARSER_REQUIRES_VISION"
  | "PARSER_REQUIRES_DOCUMENT_PARSER"
  | "PARSER_OUTPUT_TOO_LARGE"
  | "PARSER_FAILED";

export interface ParsedTextResult {
  kind: "text";
  mimeType: "text/plain";
  text: string;
  metadata: { parser: string; pageCount: number | null };
}

export interface NeedsReviewResult {
  kind: "needs_review";
  code: AssetParserFailureCode;
  message: string;
  metadata: { parser: string; pageCount?: number | null; reason: "image" | "scanned_pdf" | "unsupported" | "invalid"; /** 视觉模型生成的待校对草稿；永远不会被当作 ready 正文。 */ extractedText?: string };
}

export type AssetParserResult = ParsedTextResult | NeedsReviewResult;

const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

function normalizeText(text: string): string {
  return text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
}

function boundedText(text: string): string | NeedsReviewResult {
  const normalized = normalizeText(text);
  if (!normalized) return { kind: "needs_review", code: "PARSER_EMPTY_TEXT", message: "文件没有可读取的文本内容。", metadata: { parser: "text", reason: "invalid" } };
  if (Buffer.byteLength(normalized, "utf8") > MAX_PARSED_TEXT_BYTES) {
    return { kind: "needs_review", code: "PARSER_OUTPUT_TOO_LARGE", message: "解析文本超过 4 MiB 上限，需拆分后再导入。", metadata: { parser: "text", reason: "invalid" } };
  }
  return normalized;
}

function parsePlainText(bytes: Buffer): AssetParserResult {
  try {
    const text = boundedText(UTF8_DECODER.decode(bytes));
    if (typeof text !== "string") return text;
    if (text.includes("\u0000")) return { kind: "needs_review", code: "PARSER_INVALID_ENCODING", message: "文本包含二进制控制字节，未自动当作正文导入。", metadata: { parser: "utf8-text-v1", reason: "invalid" } };
    return { kind: "text", mimeType: "text/plain", text, metadata: { parser: "utf8-text-v1", pageCount: null } };
  } catch {
    return { kind: "needs_review", code: "PARSER_INVALID_ENCODING", message: "文本不是有效 UTF-8，未自动转换以避免内容损坏。", metadata: { parser: "utf8-text-v1", reason: "invalid" } };
  }
}

/** 上传声明的扩展名/MIME 仍不可信；Worker 在解析前执行最小文件签名校验。 */
export function assertAssetMagic(asset: Pick<AssetRecord, "extension">, bytes: Buffer): void {
  const isPng = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isWebp = bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  const isGif = bytes.length >= 6 && (bytes.subarray(0, 6).toString("ascii") === "GIF87a" || bytes.subarray(0, 6).toString("ascii") === "GIF89a");
  const isPdf = bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  const isZip = bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  const valid = asset.extension === ".png" ? isPng : asset.extension === ".jpg" || asset.extension === ".jpeg" ? isJpeg : asset.extension === ".webp" ? isWebp : asset.extension === ".gif" ? isGif : asset.extension === ".pdf" ? isPdf : asset.extension === ".docx" ? isZip : true;
  if (!valid) throw new Error("文件签名与扩展名不匹配，已拒绝解析");
}

/** 解开 PDF 字符串中的常见转义；复杂字体编码保留为待核验，不猜测文字。 */
function decodePdfLiteral(value: string): string {
  const decoded = value.replace(/\\([\\()nrtbf])/g, (_match, code: string) => ({ "\\": "\\", "(": "(", ")": ")", n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" }[code] ?? code));
  const bytes = Buffer.from(decoded, "binary");
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff && bytes.length % 2 === 0) {
    let output = "";
    for (let index = 2; index < bytes.length; index += 2) output += String.fromCharCode((bytes[index]! << 8) | bytes[index + 1]!);
    return output;
  }
  return decoded;
}

function extractPdfText(bytes: Buffer): { text: string; pageCount: number } | null {
  if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") return null;
  const raw = bytes.toString("latin1");
  const pageCount = Math.max(1, (raw.match(/\/Type\s*\/Page(?:\s|\/|>)/g) ?? []).length);
  const streams: string[] = [];
  const streamPattern = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let streamMatch: RegExpExecArray | null;
  while ((streamMatch = streamPattern.exec(raw))) {
    const start = streamMatch.index;
    const dictionary = raw.slice(Math.max(0, start - 500), start);
    const encoded = Buffer.from(streamMatch[1]!, "latin1");
    try {
      const inflated = dictionary.includes("/FlateDecode") ? inflateSync(encoded, { maxOutputLength: MAX_PARSED_TEXT_BYTES }) : encoded;
      streams.push(inflated.toString("latin1"));
    } catch {
      // 某些 PDF stream 使用不支持的过滤器；继续扫描其他 stream，最终无文本则待核验。
    }
  }
  const textParts: string[] = [];
  for (const stream of streams) {
    const literalPattern = /\(((?:\\.|[^\\()])*)\)\s*T[Jj]/g;
    let match: RegExpExecArray | null;
    while ((match = literalPattern.exec(stream))) textParts.push(decodePdfLiteral(match[1]!));
    const arrayPattern = /\[((?:\\.|[^\]])*)\]\s*TJ/g;
    while ((match = arrayPattern.exec(stream))) {
      const literals = match[1]!.match(/\(((?:\\.|[^\\()])*)\)/g) ?? [];
      textParts.push(literals.map((literal) => decodePdfLiteral(literal.slice(1, -1))).join(""));
    }
  }
  return { text: textParts.join(" "), pageCount };
}

/** 解析原生文字 PDF；没有文字层的扫描 PDF 明确进入视觉复核，不生成臆测正文。 */
function parsePdf(bytes: Buffer): AssetParserResult {
  const extracted = extractPdfText(bytes);
  if (!extracted) return { kind: "needs_review", code: "PARSER_INVALID_PDF", message: "文件不是有效 PDF。", metadata: { parser: "pdf-text-v1", pageCount: null, reason: "invalid" } };
  const text = boundedText(extracted.text);
  if (typeof text !== "string") {
    if (text.code === "PARSER_EMPTY_TEXT") return { kind: "needs_review", code: "PARSER_REQUIRES_VISION", message: "PDF 没有可提取的文字层，需要视觉模型或人工校对。", metadata: { parser: "pdf-text-v1", pageCount: extracted.pageCount, reason: "scanned_pdf" } };
    return { ...text, metadata: { ...text.metadata, parser: "pdf-text-v1", pageCount: extracted.pageCount } };
  }
  return { kind: "text", mimeType: "text/plain", text, metadata: { parser: "pdf-text-v1", pageCount: extracted.pageCount } };
}

interface ZipEntry { name: string; method: number; compressedSize: number; uncompressedSize: number; localOffset: number; }

/**
 * 仅读取 DOCX 的固定 `word/document.xml` 条目，支持 ZIP stored/deflate 两种常见形式。
 * 不遍历用户提供的路径、不落盘、不执行宏，避免 Zip Slip 和宏注入风险。
 */
function readDocxDocumentXml(bytes: Buffer): string | null {
  const eocd = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0 || eocd + 22 > bytes.length) return null;
  const directorySize = bytes.readUInt32LE(eocd + 12);
  const directoryOffset = bytes.readUInt32LE(eocd + 16);
  if (directoryOffset + directorySize > bytes.length) return null;
  const entries: ZipEntry[] = [];
  let cursor = directoryOffset;
  while (cursor + 46 <= directoryOffset + directorySize) {
    if (bytes.readUInt32LE(cursor) !== 0x02014b50) break;
    const method = bytes.readUInt16LE(cursor + 10);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const uncompressedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    entries.push({ name, method, compressedSize, uncompressedSize, localOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  const target = entries.find((entry) => entry.name === "word/document.xml");
  if (!target || target.uncompressedSize > MAX_PARSED_TEXT_BYTES) return null;
  if (target.localOffset + 30 > bytes.length || bytes.readUInt32LE(target.localOffset) !== 0x04034b50) return null;
  const localNameLength = bytes.readUInt16LE(target.localOffset + 26);
  const localExtraLength = bytes.readUInt16LE(target.localOffset + 28);
  const start = target.localOffset + 30 + localNameLength + localExtraLength;
  const end = start + target.compressedSize;
  if (end > bytes.length) return null;
  const compressed = bytes.subarray(start, end);
  try {
    const content = target.method === 0 ? compressed : target.method === 8 ? inflateRawSync(compressed) : null;
    if (!content || content.length !== target.uncompressedSize) return null;
    return content.toString("utf8");
  } catch {
    return null;
  }
}

function decodeXmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos);/gi, (_match, entity: string) => {
    const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };
    if (named[entity.toLowerCase()]) return named[entity.toLowerCase()]!;
    const number = entity[0]?.toLowerCase() === "x" ? Number.parseInt(entity.slice(1), 16) : Number.parseInt(entity.slice(1), 10);
    return Number.isFinite(number) ? String.fromCodePoint(number) : "";
  });
}

function parseDocx(bytes: Buffer): AssetParserResult {
  if (bytes.subarray(0, 2).toString("latin1") !== "PK") return { kind: "needs_review", code: "PARSER_INVALID_DOCX", message: "文件不是有效 DOCX。", metadata: { parser: "docx-xml-v1", reason: "invalid" } };
  const xml = readDocxDocumentXml(bytes);
  if (!xml) return { kind: "needs_review", code: "PARSER_INVALID_DOCX", message: "DOCX 结构无法安全读取，未执行宏或任意 XML 外部实体。", metadata: { parser: "docx-xml-v1", reason: "invalid" } };
  const text = xml
    .replace(/<w:tab\s*\/>/gi, "\t")
    .replace(/<w:(?:br|cr)[^>]*\/>/gi, "\n")
    .replace(/<\/w:p>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  const bounded = boundedText(decodeXmlEntities(text));
  if (typeof bounded !== "string") return { ...bounded, metadata: { ...bounded.metadata, parser: "docx-xml-v1" } };
  return { kind: "text", mimeType: "text/plain", text: bounded, metadata: { parser: "docx-xml-v1", pageCount: null } };
}

/**
 * 根据服务端已校验的扩展名选择解析器。图片与扫描件不调用外部模型，进入待校对状态，
 * 这样 Worker 可真实完成状态流转，同时不会把 OCR 猜测冒充为来源事实。
 */
export function parseAsset(asset: Pick<AssetRecord, "extension" | "mimeType">, bytes: Buffer): AssetParserResult {
  switch (asset.extension) {
    case ".txt":
    case ".md":
      return parsePlainText(bytes);
    case ".pdf":
      return parsePdf(bytes);
    case ".docx":
      return parseDocx(bytes);
    case ".png":
    case ".jpg":
    case ".jpeg":
    case ".webp":
    case ".gif":
      return { kind: "needs_review", code: "PARSER_REQUIRES_VISION", message: "图片解析需要显式配置视觉模型或人工校对。", metadata: { parser: "image-boundary-v1", reason: "image" } };
    default:
      return { kind: "needs_review", code: "PARSER_REQUIRES_DOCUMENT_PARSER", message: `暂不支持 ${asset.mimeType} 的安全解析。`, metadata: { parser: "unsupported-v1", reason: "unsupported" } };
  }
}
