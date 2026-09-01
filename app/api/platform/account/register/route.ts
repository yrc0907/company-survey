import { z } from "zod";

import { authErrorResponse } from "@/lib/auth/api-response";
import { argon2idPasswordHasher } from "@/lib/auth/password";
import { assertTrustedJsonRequest } from "@/lib/auth/request-security";
import { json } from "@/lib/api/http";
import { getPlatformRepository } from "@/lib/repositories/platform/platform-repository-factory";
import { AccountService } from "@/lib/services/platform/account-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const registerSchema = z.object({
  email: z.string().trim().email().max(320),
  username: z.string().trim().min(3).max(32),
  displayName: z.string().trim().min(1).max(80).optional(),
  password: z.string().min(10).max(128)
    .refine((value) => /[A-Za-z]/.test(value) && /\d/.test(value), "密码至少包含一个字母和一个数字"),
}).strict();

/** 创建邮箱密码账户；成功只返回安全资料，不自动登录也不返回密码哈希。 */
export async function POST(request: Request) {
  try {
    assertTrustedJsonRequest(request);
    const input = registerSchema.parse(await request.json());
    const account = await new AccountService(getPlatformRepository(), argon2idPasswordHasher).register(input);
    return json({ account }, { status: 201 });
  } catch (error) {
    return authErrorResponse(error);
  }
}
