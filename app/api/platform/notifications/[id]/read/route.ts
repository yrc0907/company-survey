import { errorResponse, json } from "@/lib/api/http";
import { assertTrustedJsonRequest } from "@/lib/auth/request-security";
import { requireAuthenticatedActor } from "@/lib/auth/session";
import { getNotificationRepository } from "@/lib/repositories/platform/notification-repository-factory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 仅允许当前收件人标记自己的通知，重复请求保持幂等。 */
export async function POST(request: Request, context: { params: { id: string } }): Promise<Response> {
  try { assertTrustedJsonRequest(request); const actor = await requireAuthenticatedActor(); const marked = await getNotificationRepository().markRead(actor.userId, context.params.id); return marked ? json({ marked: true }) : json({ error: "通知不存在" }, { status: 404 }); }
  catch (error) { return errorResponse(error); }
}
