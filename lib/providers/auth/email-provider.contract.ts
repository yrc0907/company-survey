import assert from "node:assert/strict";
import type { Transporter } from "nodemailer";

import { getEmailProvider, SmtpEmailProvider } from "@/lib/providers/auth/email-provider";

async function run(): Promise<void> {
  assert.throws(() => getEmailProvider({ EMAIL_PROVIDER: "smtp", SMTP_HOST: "smtp.example.com", SMTP_USER: "noreply@example.com", SMTP_PASSWORD: "test" }), /不支持的邮件 Provider/, "普通 SMTP Provider 必须被拒绝");
  assert.throws(() => SmtpEmailProvider.fromEnvironment({ SMTP_HOST: "smtp.example.com", SMTP_USER: "noreply@example.com", SMTP_PASSWORD: "test", EMAIL_FROM: "other@elsewhere.example" }), /同一发信域/);

  let sent = false;
  const transporter = { sendMail: async (message: { to: string }) => { sent = message.to === "member@example.com"; return { messageId: "enterprise-message-1" }; } } as unknown as Transporter;
  const provider = new SmtpEmailProvider(transporter, "noreply@example.com");
  const receipt = await provider.send({ to: "member@example.com", subject: "验证", text: "code", html: "<p>code</p>" });
  assert.equal(receipt.providerMessageId, "enterprise-message-1");
  assert.equal(sent, true);

  const failed = new SmtpEmailProvider({ sendMail: async () => { throw new Error("temporary SMTP failure"); } } as unknown as Transporter, "noreply@example.com");
  await assert.rejects(failed.send({ to: "member@example.com", subject: "验证", text: "code", html: "<p>code</p>" }), /temporary SMTP failure/);
  console.log("enterprise email provider contract: passed");
}

void run().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
