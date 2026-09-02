import { z } from "zod";

import { authErrorResponse } from "@/lib/auth/api-response";
import { assertTrustedJsonRequest } from "@/lib/auth/request-security";
import { requireAuthenticatedActor } from "@/lib/auth/session";
import { json } from "@/lib/api/http";
import { getVerificationService } from "@/lib/services/auth/verification-service-factory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ challengeId: z.string().uuid(), destination: z.string().trim().min(3).max(320), code: z.string().regex(/^\d{6}$/) }).strict();

/** 校验邮箱验证/手机号绑定挑战；登录挑战由 Auth.js Credentials 在同一事务中消费。 */
export async function POST(request: Request): Promise<Response> {
  try {
    assertTrustedJsonRequest(request);
    const input = schema.parse(await request.json());
    const actor = await requireAuthenticatedActor();
    const result = await getVerificationService().verifyChallenge({ ...input, actorUserId: actor.userId });
    if ((result.purpose === "email_verification" || result.purpose === "email_change" || result.purpose === "phone_bind" || result.purpose === "phone_change") && result.account.id !== actor.userId) {
      return json({ error: "不能验证其他账户的身份", code: "PERMISSION_DENIED" }, { status: 403 });
    }
    if (result.purpose === "email_login" || result.purpose === "phone_login") return json({ error: "登录验证码请通过登录接口提交", code: "INVALID_VERIFICATION_PURPOSE" }, { status: 400 });
    return json({ verified: true, purpose: result.purpose }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return authErrorResponse(error);
  }
}
