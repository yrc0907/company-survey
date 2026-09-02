import assert from "node:assert/strict";

import { OpenAiCompatibleVisionParser, getVisionParser } from "@/lib/providers/vision-provider";

/** 视觉 Provider 契约：未显式开启不创建；响应只形成待校对草稿，不自动变成 ready。 */
async function run(): Promise<void> {
  assert.equal(getVisionParser({ VISION_ENABLED: "false", VISION_API_KEY: "key", VISION_API_BASE_URL: "https://example.com/v1" }), null);
  const requests: Request[] = [];
  const parser = new OpenAiCompatibleVisionParser({ apiBaseUrl: "https://example.com/v1", apiKey: "secret", model: "vision-test", timeoutMs: 5_000 }, async (input, init) => {
    requests.push(new Request(input, init));
    return new Response(JSON.stringify({ choices: [{ message: { content: "识别出的标题\n第二行" } }] }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const result = await parser.parse({ asset: { filename: "note.png", mimeType: "image/png", extension: ".png" }, bytes: Buffer.from([137, 80, 78, 71]) });
  assert.equal(result.kind, "needs_review");
  assert.equal(result.metadata.extractedText, "识别出的标题\n第二行");
  assert.equal(requests.length, 1);
  const requestBody = await requests[0]!.json() as { messages?: Array<{ content?: unknown }> };
  assert.ok(Array.isArray(requestBody.messages?.[1]?.content));
  const failed = await parser.parse({ asset: { filename: "big.png", mimeType: "image/png", extension: ".png" }, bytes: Buffer.alloc(8 * 1024 * 1024 + 1) });
  assert.equal(failed.metadata.extractedText, undefined);
  console.log("vision-provider contract: passed");
}

void run().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
