import type { AssetRecord } from "@/lib/domain/assets";
import type { NeedsReviewResult } from "@/lib/services/assets/asset-parser";

/** 视觉解析只接收已校验的图片原件，输出待校对文本，不直接进入事实索引。 */
export interface VisionParser {
  parse(input: { asset: Pick<AssetRecord, "filename" | "mimeType" | "extension">; bytes: Buffer }): Promise<NeedsReviewResult>;
}

interface VisionConfig { apiBaseUrl: string; apiKey: string; model: string; timeoutMs: number; }
type FetchImplementation = typeof fetch;

function endpoint(baseUrl: string): URL {
  const base = new URL(baseUrl);
  if (base.protocol !== "https:" && base.protocol !== "http:") throw new Error("视觉模型地址协议无效");
  const path = base.pathname.replace(/\/+$/, "");
  return new URL(`${path.endsWith("/v1") ? path : `${path}/v1`}/chat/completions`, base.origin);
}

function messageText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";
  return value.map((part) => part && typeof part === "object" && "text" in part && typeof part.text === "string" ? part.text : "").join("\n").trim();
}

function configFrom(environment: Record<string, string | undefined>): VisionConfig | null {
  if (environment.VISION_ENABLED?.trim().toLowerCase() !== "true") return null;
  const apiKey = environment.VISION_API_KEY?.trim() || environment.DEEPSEEK_API_KEY?.trim() || environment.MODEL_API_KEY?.trim();
  const apiBaseUrl = environment.VISION_API_BASE_URL?.trim() || environment.DEEPSEEK_API_BASE_URL?.trim() || environment.MODEL_API_BASE_URL?.trim();
  const model = environment.VISION_MODEL?.trim() || environment.DEEPSEEK_VISION_MODEL?.trim() || "gpt-4o-mini";
  if (!apiKey || !apiBaseUrl || !model) return null;
  const timeoutMs = Math.min(Math.max(Number(environment.VISION_TIMEOUT_MS ?? 45_000), 5_000), 120_000);
  return { apiBaseUrl, apiKey, model, timeoutMs };
}

/** OpenAI-compatible视觉 Provider；可替换成 DeepSeek/Cloudmist，不把端点或密钥返回到客户端。 */
export class OpenAiCompatibleVisionParser implements VisionParser {
  public constructor(private readonly config: VisionConfig, private readonly fetchImplementation: FetchImplementation = fetch) {}

  public async parse(input: { asset: Pick<AssetRecord, "filename" | "mimeType" | "extension">; bytes: Buffer }): Promise<NeedsReviewResult> {
    const maxBytes = 8 * 1024 * 1024;
    if (!input.asset.mimeType.toLowerCase().startsWith("image/") || input.bytes.length > maxBytes) {
      return { kind: "needs_review", code: "PARSER_REQUIRES_VISION", message: "图片超过视觉解析大小上限或 MIME 不受支持，需人工校对。", metadata: { parser: "vision-boundary-v1", reason: "image" } };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await this.fetchImplementation(endpoint(this.config.apiBaseUrl), {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.config.apiKey}` },
        body: JSON.stringify({
          model: this.config.model,
          temperature: 0,
          messages: [{ role: "system", content: "你是文档视觉转写器。只转录图片中实际可见的文字和表格，不补全、不推断、不总结；无法辨认处写[无法辨认]。输出纯文本，不要 Markdown 代码围栏。" }, { role: "user", content: [{ type: "text", text: `文件名（仅作标签）：${input.asset.filename}` }, { type: "image_url", image_url: { url: `data:${input.asset.mimeType};base64,${input.bytes.toString("base64")}`, detail: "high" } }] }],
        }),
        signal: controller.signal,
      });
      if (!response.ok) return { kind: "needs_review", code: "PARSER_FAILED", message: "视觉模型请求失败，文件已保留待人工校对。", metadata: { parser: "vision-api-v1", reason: "image" } };
      const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
      const extractedText = messageText(payload.choices?.[0]?.message?.content).replace(/```[\s\S]*?```/g, (block) => block.replace(/^```[^\n]*\n?/, "").replace(/```$/, "")).trim();
      if (!extractedText) return { kind: "needs_review", code: "PARSER_EMPTY_TEXT", message: "视觉模型没有返回可校对文字。", metadata: { parser: "vision-api-v1", reason: "image" } };
      const bounded = extractedText.slice(0, 120_000);
      return { kind: "needs_review", code: "PARSER_REQUIRES_VISION", message: "视觉模型已生成待校对草稿；确认前不会进入检索或企业事实。", metadata: { parser: "vision-api-v1", reason: "image", extractedText: bounded } };
    } catch {
      return { kind: "needs_review", code: "PARSER_FAILED", message: "视觉模型超时或连接失败，文件已保留待人工校对。", metadata: { parser: "vision-api-v1", reason: "image" } };
    } finally { clearTimeout(timer); }
  }
}

/** 仅明确开启 VISION_ENABLED 且配置密钥时创建 Provider，默认不产生外部模型费用。 */
export function getVisionParser(environment: Record<string, string | undefined> = process.env): VisionParser | null {
  const config = configFrom(environment);
  return config ? new OpenAiCompatibleVisionParser(config) : null;
}
