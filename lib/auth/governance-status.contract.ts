import assert from "node:assert/strict";
import { GET } from "@/app/api/auth/status/route";
import { getAuthGovernanceStatus } from "@/lib/auth/governance-status";

async function run(): Promise<void> {
  const missing = getAuthGovernanceStatus({});
  assert.equal(missing.oauth.github, "not_configured");
  assert.equal(missing.email.verification, "not_configured");
  assert.equal(missing.email.passwordReset, "not_configured");
  assert.equal(missing.scenario_id, "AUTH-GOVERNANCE-001");
  assert.equal(getAuthGovernanceStatus({ GITHUB_CLIENT_ID: "id" }).oauth.github, "not_configured", "半配置 OAuth 必须 fail-closed");
  assert.equal(getAuthGovernanceStatus({ GITHUB_CLIENT_ID: "id", GITHUB_CLIENT_SECRET: "secret" }).oauth.github, "configured");
  const response = await GET();
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json() as { email: { passwordReset: string } };
  assert.equal(body.email.passwordReset, "not_configured");
  console.log("auth governance contract: passed");
}

void run().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
