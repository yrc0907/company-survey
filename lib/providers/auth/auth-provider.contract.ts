import assert from "node:assert/strict";

import { AliyunCaptchaProvider } from "@/lib/providers/auth/captcha-provider";
import { AliyunSmsProvider } from "@/lib/providers/auth/sms-provider";

/** Provider 契约测试只替换 fetch，不触达阿里云；验证重试、幂等头及常见返回字段映射。 */
async function run(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const requests: Request[] = [];
  let smsAttempt = 0;
  globalThis.fetch = async (input, init) => {
    requests.push(new Request(input, init));
    smsAttempt += 1;
    if (smsAttempt === 1) return new Response(JSON.stringify({ Code: "ServiceUnavailable" }), { status: 503 });
    return new Response(JSON.stringify({ Code: "OK", RequestId: "req-1" }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const provider = new AliyunSmsProvider("https://sms.invalid", "app-id", "app-key", "scheme", "sign", "100001", 500);
    const receipt = await provider.send({ phoneE164: "+8613800138000", code: "123456", codeExpireMinutes: 10, idempotencyKey: "challenge-1" });
    assert.equal(receipt.providerMessageId, "req-1");
    assert.equal(requests.length, 2, "503 应仅重试一次");
    assert.equal(requests[1]!.headers.get("x-idempotency-key"), "challenge-1");
    assert.match(await requests[1]!.text(), /challenge-1/);

    const ticket = JSON.stringify({ lot_number: "lot", captcha_output: "out", pass_token: "pass", gen_time: "now" });
    globalThis.fetch = async () => new Response(JSON.stringify({ result: "success" }), { status: 200 });
    const captcha = new AliyunCaptchaProvider("https://captcha.invalid", "captcha-id", "captcha-key", "research");
    assert.equal(await captcha.verify({ ticket, scene: "email_login", clientIp: null, userId: null }), true);
    globalThis.fetch = async () => new Response(JSON.stringify({ result: "fail" }), { status: 200 });
    assert.equal(await captcha.verify({ ticket, scene: "email_login", clientIp: null, userId: null }), false);
    console.log("auth provider contract: passed");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void run().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
