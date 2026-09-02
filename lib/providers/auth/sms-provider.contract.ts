import assert from "node:assert/strict";

import { AliyunSmsProvider } from "@/lib/providers/auth/sms-provider";

/** 短信认证 Provider 契约：不触达阿里云，验证 RPC 参数、签名和一次重试。 */
async function run(): Promise<void> {
  const requests: Request[] = [];
  let attempts = 0;
  const fetcher: typeof fetch = async (input, init) => {
    requests.push(new Request(input, init)); attempts += 1;
    return attempts === 1
      ? new Response(JSON.stringify({ Code: "ServiceUnavailable" }), { status: 503 })
      : new Response(JSON.stringify({ Code: "OK", Model: { VerifyCode: "654321", RequestId: "req-1" } }), { status: 200 });
  };
  const provider = new AliyunSmsProvider("https://dypnsapi.aliyuncs.com/", "ram-id", "ram-secret", "scheme", "sign", "100001", 1_000, fetcher);
  const receipt = await provider.send({ phoneE164: "+8613800138000", code: "123456", codeExpireMinutes: 10, idempotencyKey: "challenge-1" });
  assert.equal(receipt.providerMessageId, "req-1");
  assert.equal(requests.length, 2);
  const params = new URLSearchParams(await requests[1]!.text());
  assert.equal(params.get("Action"), "SendSmsVerifyCode");
  assert.equal(params.get("Version"), "2017-05-25");
  assert.equal(params.get("OutId"), "challenge-1");
  assert.ok(params.get("Signature"));
  assert.match(params.get("TemplateParam") ?? "", /123456/);
  assert.ok(AliyunSmsProvider.fromEnvironment({ ALIYUN_SMS_ACCESS_KEY_ID: "id", ALIYUN_SMS_ACCESS_KEY_SECRET: "secret", ALIYUN_SMS_SCHEME_NAME: "research" }));
  assert.equal(AliyunSmsProvider.fromEnvironment({ ALIYUN_SMS_ACCESS_KEY_ID: "id", ALIYUN_SMS_ACCESS_KEY_SECRET: "secret" }), null);
  console.log("sms-provider contract: passed");
}
void run().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
