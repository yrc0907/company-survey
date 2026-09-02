import { getCaptchaProvider } from "@/lib/providers/auth/captcha-provider";
import { getEmailProvider } from "@/lib/providers/auth/email-provider";
import { getSmsProvider } from "@/lib/providers/auth/sms-provider";
import { getPlatformRepository } from "@/lib/repositories/platform/platform-repository-factory";
import { getVerificationRepository } from "@/lib/repositories/auth/verification-repository-factory";
import { VerificationService } from "@/lib/services/auth/verification-service";

let service: VerificationService | null = null;

/** 生产验证码服务从统一工厂创建，保证账户与挑战使用同一数据库配置。 */
export function getVerificationService(): VerificationService {
  if (service) return service;
  service = new VerificationService({
    accounts: getPlatformRepository(), challenges: getVerificationRepository(),
    emailProvider: getEmailProvider(), smsProvider: getSmsProvider(), captchaProvider: getCaptchaProvider(),
  });
  return service;
}

/** 仅供测试清理缓存，避免环境变量和仓储在契约测试间串联。 */
export function resetVerificationServiceForTest(): void {
  service = null;
}
