import { errorResponse, json } from "@/lib/api/http";
import { assertTrustedJsonRequest } from "@/lib/auth/request-security";
import { requireAuthenticatedActor } from "@/lib/auth/session";
import { getNotificationRepository } from "@/lib/repositories/platform/notification-repository-factory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 将当前用户所有未读通知标记为已读；不会影响其他用户或历史事件。 */
export async function POST(request: Request): Promise<Response> {
  try { assertTrustedJsonRequest(request); const actor = await requireAuthenticatedActor(); return json({ markedCount: await getNotificationRepository().markAllRead(actor.userId) }); }
  catch (error) { return errorResponse(error); }
}
