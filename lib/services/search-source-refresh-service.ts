import { createHash, randomUUID } from "node:crypto";
import dns from "node:dns/promises";

import { ValidationError } from "@/lib/domain/errors";
import type { Source, SourceChunk } from "@/lib/domain/research";
import type { ResearchRepository } from "@/lib/providers/research-repository";
import { assertSafeSourceUrl } from "@/lib/security/source-url";

export const MAX_REFRESH_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 12_000;

export interface SourceRefreshResult { status: "unchanged" | "needs_review"; source: Source; chunks: SourceChunk[]; }
export type SourceFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type ResolveHost = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

/** 对 URL 来源做 DNS 级内网防护；文本黑名单不足以防止域名解析到私网地址。 */
async function assertPublicResolution(url: URL, resolveHost: ResolveHost): Promise<void> {
  const addresses = await resolveHost(url.hostname);
  if (addresses.length === 0 || addresses.some(({ address }) => {
    const value = address.toLowerCase();
    return value === "::1" || value === "0.0.0.0" || value.startsWith("10.") || value.startsWith("192.168.")
      || value.startsWith("169.254.") || /^172\.(1[6-9]|2\d|3[0-1])\./.test(value)
      || value.startsWith("127.") || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe80:");
  })) throw new ValidationError("来源域名解析到本机或内网地址");
}

async function readLimited(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_REFRESH_BYTES) throw new ValidationError("来源响应超过大小上限");
  if (!response.body) throw new ValidationError("来源响应没有正文");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let total = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > MAX_REFRESH_BYTES) { await reader.cancel(); throw new ValidationError("来源响应超过大小上限"); }
    chunks.push(part.value);
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
}

function sha256(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }

/**
 * 抓取已有 URL 来源并做内容变更检测。重定向、非文本响应、超时或私网解析均拒绝；
 * 变更内容以 needs_review 新快照写入，旧 active 来源和正文永不覆盖。
 */
export class SearchSourceRefreshService {
  public constructor(private readonly repository: ResearchRepository, private readonly fetchImplementation: SourceFetch = fetch, private readonly resolveHost: ResolveHost = async (hostname) => dns.lookup(hostname, { all: true, verbatim: true })) {}

  public async refresh(sourceId: string): Promise<SourceRefreshResult> {
    const snapshot = await this.repository.getSnapshot();
    const current = snapshot.sources.find((source) => source.id === sourceId);
    if (!current) throw new ValidationError("来源不存在");
    if (!current.url) throw new ValidationError("只有 URL 来源支持刷新");
    const url = assertSafeSourceUrl(current.url);
    await assertPublicResolution(url, this.resolveHost);
    let response: Response;
    try {
      response = await this.fetchImplementation(url, { redirect: "manual", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { accept: "text/html,text/plain" } });
    } catch { throw new ValidationError("来源请求超时或网络不可用"); }
    if (response.status >= 300 && response.status < 400) throw new ValidationError("来源不允许重定向");
    if (!response.ok) throw new ValidationError(`来源请求失败（${response.status}）`);
    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    if (contentType && !contentType.includes("text/html") && !contentType.includes("text/plain")) throw new ValidationError("来源不是可安全读取的文本响应");
    const text = (await readLimited(response)).replace(/\r\n?/g, "\n").trim();
    if (!text) throw new ValidationError("来源响应为空");
    const contentHash = sha256(text);
    if (contentHash === current.contentHash) return { status: "unchanged", source: current, chunks: snapshot.chunks.filter((chunk) => chunk.sourceId === current.id) };
    const reviewSource: Source = { ...current, id: randomUUID(), state: "needs_review", capturedAt: new Date().toISOString(), contentHash, snapshot: text };
    const chunk: SourceChunk = { id: randomUUID(), sourceId: reviewSource.id, parentSectionId: null, headingPath: [reviewSource.title], position: 1, page: null, startOffset: 0, endOffset: text.length, text, contextualPrefix: `来源刷新待复核；原来源：${current.id}。`, contentHash };
    await this.repository.createTextSource(reviewSource, [chunk]);
    return { status: "needs_review", source: reviewSource, chunks: [chunk] };
  }
}
