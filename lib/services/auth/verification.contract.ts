import assert from "node:assert/strict";

import { MemoryVerificationRepository } from "@/lib/repositories/auth/memory-verification-repository";
import { MemoryPlatformRepository } from "@/lib/repositories/platform/memory-platform-repository";
import { AccountService } from "@/lib/services/platform/account-service";
import { VerificationService } from "@/lib/services/auth/verification-service";
import { argon2idPasswordHasher } from "@/lib/auth/password";
import type { CaptchaProvider } from "@/lib/providers/auth/captcha-provider";
import type { EmailProvider } from "@/lib/providers/auth/email-provider";
import type { SmsProvider } from "@/lib/providers/auth/sms-provider";

class PassCaptcha implements CaptchaProvider {
  public async verify(): Promise<boolean> { return true; }
}

class CaptureEmail implements EmailProvider {
  public lastCode = "";
  public async send(message: { to: string; subject: string; text: string; html: string }): Promise<{ providerMessageId: string | null }> {
    this.lastCode = message.text.match(/验证码是 (\d{6})/)?.[1] ?? "";
    return { providerMessageId: "email-test" };
  }
}

class CaptureSms implements SmsProvider {
  public lastCode = "";
  public async send(message: { phoneE164: string; code: string; codeExpireMinutes: number }): Promise<{ providerMessageId: string | null }> {
    this.lastCode = message.code;
    return { providerMessageId: "sms-test" };
  }
}

async function run(): Promise<void> {
  const accounts = new MemoryPlatformRepository();
  const challenges = new MemoryVerificationRepository();
  const email = new CaptureEmail();
  const sms = new CaptureSms();
  const service = new VerificationService({ accounts, challenges, emailProvider: email, smsProvider: sms, captchaProvider: new PassCaptcha(), environment: { NODE_ENV: "test", NEXTAUTH_SECRET: "test-secret", CAPTCHA_REQUIRED: "true", AUTH_CODE_EXPIRE_MINUTES: "1" } });
  const account = await new AccountService(accounts, argon2idPasswordHasher).register({ email: "member@example.com", username: "member", password: "securePass123" });
  const actor = { userId: account.id, role: "user" as const };

  const emailReceipt = await service.requestCode({ channel: "email", purpose: "email_verification", destination: account.email, actor, captchaTicket: "ticket", clientIp: "127.0.0.1", deviceId: "device-1" });
  assert.ok(emailReceipt.challengeId, "邮件验证必须返回挑战 ID");
  await assert.rejects(service.verifyChallenge({ challengeId: emailReceipt.challengeId, destination: account.email, code: "000000" }), /验证码无效/);
  const verifiedEmail = await service.verifyChallenge({ challengeId: emailReceipt.challengeId, destination: account.email, code: email.lastCode });
  assert.equal(verifiedEmail.account.emailVerifiedAt !== null, true, "正确验证码应标记邮箱已验证");
  await assert.rejects(service.verifyChallenge({ challengeId: emailReceipt.challengeId, destination: account.email, code: email.lastCode }), /验证码无效/, "挑战必须只能消费一次");

  const phoneReceipt = await service.requestCode({ channel: "sms", purpose: "phone_bind", destination: "13800138000", actor, captchaTicket: "ticket", clientIp: "127.0.0.1", deviceId: "device-1" });
  await service.verifyChallenge({ challengeId: phoneReceipt.challengeId, destination: "13800138000", code: sms.lastCode });
  const phoneAccount = await accounts.findAccountByPhone("+8613800138000");
  assert.equal(phoneAccount?.id, account.id, "手机号绑定后应落到同一用户");

  const emailChange = await service.requestCode({ channel: "email", purpose: "email_change", destination: "member-new@example.com", actor, captchaTicket: "ticket", clientIp: "127.0.0.1", deviceId: "device-1" });
  await service.verifyChallenge({ challengeId: emailChange.challengeId, destination: "member-new@example.com", code: email.lastCode, actorUserId: account.id });
  assert.equal((await accounts.findAccountByEmail("member-new@example.com"))?.id, account.id, "邮箱换绑后应仍属于原账户");
  const audits = await accounts.listIdentityAudit(account.id);
  assert.ok(audits.some((entry) => entry.channel === "email" && entry.action === "change" && entry.outcome === "success"));

  const other = await new AccountService(accounts, argon2idPasswordHasher).register({ email: "other@example.com", username: "other", password: "securePass123" });
  await assert.rejects(service.requestCode({ channel: "email", purpose: "email_change", destination: other.email, actor, captchaTicket: "ticket", clientIp: "127.0.0.1", deviceId: "device-1" }), /已绑定其他账户/);

  const loginReceipt = await service.requestCode({ channel: "sms", purpose: "phone_login", destination: "+8613800138000", actor: null, captchaTicket: "ticket", clientIp: "127.0.0.1", deviceId: "device-2" });
  const logged = await service.verifyChallenge({ challengeId: loginReceipt.challengeId, destination: "+8613800138000", code: sms.lastCode });
  assert.equal(logged.account.id, account.id, "手机号验证码登录不能创建重复账户");

  // 未注册身份只有在正确 OTP 后才自动开户；邮箱和手机号都应得到可重复登录的同一账户。
  const autoEmailReceipt = await service.requestCode({ channel: "email", purpose: "email_login", destination: "first-login@example.com", actor: null, captchaTicket: "ticket", clientIp: "127.0.0.4", deviceId: "device-5" });
  assert.ok(autoEmailReceipt.challengeId, "未知邮箱验证码登录必须创建待验证挑战");
  const autoEmail = await service.verifyChallenge({ challengeId: autoEmailReceipt.challengeId, destination: "first-login@example.com", code: email.lastCode });
  assert.equal((await accounts.findAccountByEmail("first-login@example.com"))?.id, autoEmail.account.id, "邮箱 OTP 后应自动创建账户");
  assert.equal(autoEmail.account.emailVerifiedAt !== null, true, "自动创建的邮箱账户必须标记已验证");

  const autoPhoneReceipt = await service.requestCode({ channel: "sms", purpose: "phone_login", destination: "13900139000", actor: null, captchaTicket: "ticket", clientIp: "127.0.0.5", deviceId: "device-6" });
  assert.ok(autoPhoneReceipt.challengeId, "未知手机号验证码登录必须创建待验证挑战");
  const autoPhone = await service.verifyChallenge({ challengeId: autoPhoneReceipt.challengeId, destination: "13900139000", code: sms.lastCode });
  assert.equal((await accounts.findAccountByPhone("+8613900139000"))?.id, autoPhone.account.id, "手机号 OTP 后应自动创建账户");
  assert.equal(autoPhone.account.phoneVerifiedAt !== null, true, "自动创建的手机号账户必须标记已验证");

  // 第五次输入仍允许正确验证码，只有第六次才应被错误次数上限拒绝。
  const fifthAttempt = await service.requestCode({ channel: "email", purpose: "email_login", destination: "member-new@example.com", actor: null, captchaTicket: "ticket", clientIp: "127.0.0.2", deviceId: "device-3" });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await assert.rejects(service.verifyChallenge({ challengeId: fifthAttempt.challengeId, destination: "member-new@example.com", code: "000000" }), /验证码无效/);
  }
  const fifthVerified = await service.verifyChallenge({ challengeId: fifthAttempt.challengeId, destination: "member-new@example.com", code: email.lastCode });
  assert.equal(fifthVerified.account.id, account.id, "第五次输入正确验证码仍应允许消费");

  // 限流桶按目标维度计数，挑战消费后再次请求仍不得绕过窗口。
  const limitedAccount = await new AccountService(accounts, argon2idPasswordHasher).register({ email: "limited@example.com", username: "limited", password: "securePass123" });
  const limitedService = new VerificationService({ accounts, challenges, emailProvider: email, smsProvider: sms, captchaProvider: new PassCaptcha(), environment: { NODE_ENV: "test", NEXTAUTH_SECRET: "test-secret", CAPTCHA_REQUIRED: "true", AUTH_CODE_EXPIRE_MINUTES: "1", AUTH_RATE_LIMIT_DESTINATION_MAX: "1" } });
  const limitedReceipt = await limitedService.requestCode({ channel: "email", purpose: "email_login", destination: limitedAccount.email, actor: null, captchaTicket: "ticket", clientIp: "127.0.0.3", deviceId: "device-4" });
  await limitedService.verifyChallenge({ challengeId: limitedReceipt.challengeId, destination: limitedAccount.email, code: email.lastCode });
  await assert.rejects(limitedService.requestCode({ channel: "email", purpose: "email_login", destination: limitedAccount.email, actor: null, captchaTicket: "ticket", clientIp: "127.0.0.3", deviceId: "device-4" }), /操作过于频繁/);
  console.log("verification contract: passed");
}

void run().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
