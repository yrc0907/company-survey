import { z } from "zod";

import { argon2idPasswordHasher } from "@/lib/auth/password";
import { authErrorResponse } from "@/lib/auth/api-response";
import { assertTrustedJsonRequest } from "@/lib/auth/request-security";
import { json } from "@/lib/api/http";
import { getVerificationService } from "@/lib/services/auth/verification-service-factory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  challengeId: z.string().uuid(), destination: z.string().trim().email().max(320), code: z.string().regex(/^\d{6}$/),
  newPassword: z.string().min(10).max(128).refine((value) => /[A-Za-z]/.test(value) && /\d/.test(value), "密码至少包含一个字母和一个数字"),
}).strict();

/** 通过已消费的 password_reset 挑战更新 Argon2id 密码；成功后旧锁定状态清除。 */
export async function POST(request: Request): Promise<Response> {
  try {
    assertTrustedJsonRequest(request);
    const input = schema.parse(await request.json());
    const account = await getVerificationService().resetPassword({ challengeId: input.challengeId, destination: input.destination, code: input.code, newPasswordHash: await argon2idPasswordHasher.hash(input.newPassword) });
    return json({ reset: true, account: { id: account.id, username: account.username } }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return authErrorResponse(error);
  }
}
