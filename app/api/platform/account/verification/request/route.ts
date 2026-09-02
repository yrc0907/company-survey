import { z } from "zod";

import { authErrorResponse } from "@/lib/auth/api-response";
import { assertTrustedJsonRequest } from "@/lib/auth/request-security";
import { getAuthenticatedActor } from "@/lib/auth/session";
import type { VerificationChannel, VerificationPurpose } from "@/lib/domain/platform";
import { json } from "@/lib/api/http";
import { getVerificationService } from "@/lib/services/auth/verification-service-factory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  channel: z.enum(["email", "sms"]),
  purpose: z.enum(["email_verification", "email_login", "password_reset", "email_change", "phone_login", "phone_bind", "phone_change"]),
  destination: z.string().trim().min(3).max(320),
  captchaTicket: z.string().trim().max(4096).nullable().optional(),
  deviceId: z.string().trim().max(256).nullable().optional(),
}).strict();

/** 发送邮箱/短信验证码；当前用户身份只从 Session 读取，不接受客户端 userId。 */
export async function POST(request: Request): Promise<Response> {
  try {
    assertTrustedJsonRequest(request);
    const input = requestSchema.parse(await request.json());
    const actor = await getAuthenticatedActor();
    const receipt = await getVerificationService().requestCode({
      channel: input.channel as VerificationChannel, purpose: input.purpose as VerificationPurpose,
      destination: input.destination, actor, captchaTicket: input.captchaTicket ?? null,
      clientIp: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip"),
      deviceId: input.deviceId ?? null,
    });
    return json({ accepted: true, receipt }, { status: 202, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return authErrorResponse(error);
  }
}
