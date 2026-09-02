import assert from "node:assert/strict";
import { AliyunCaptchaProvider } from "./captcha-provider";

async function run(): Promise<void> {
  const originalFetch = globalThis.fetch;
  try {
  let body = "";
  globalThis.fetch = async (_input, init) => { body = String(init?.body ?? ""); return new Response(JSON.stringify({ success: true }), { status: 200 }); };
  const provider = AliyunCaptchaProvider.fromEnvironment({ ALIYUN_CAPTCHA_APP_ID: "id", ALIYUN_CAPTCHA_APP_KEY: "key", ALIYUN_CAPTCHA_SCENE_ID: "research" });
  assert.ok(provider);
  assert.equal(await provider.verify({ ticket: "ticket", scene: "email_login", clientIp: "203.0.113.4", userId: null }), true);
  assert.match(body, /CaptchaVerifyParam/); assert.match(body, /SceneId/); assert.match(body, /RemoteIp/);
  assert.equal(AliyunCaptchaProvider.fromEnvironment({ ALIYUN_CAPTCHA_API_URL: "http://localhost/verify", ALIYUN_CAPTCHA_APP_ID: "id", ALIYUN_CAPTCHA_APP_KEY: "key", ALIYUN_CAPTCHA_SCENE_ID: "research" }), null);
  console.log("captcha provider contract: passed");
  } finally { globalThis.fetch = originalFetch; }
}
void run().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
