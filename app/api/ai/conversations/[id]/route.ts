import { z } from "zod";

import { errorResponse, json } from "@/lib/api/http";
import { authErrorResponse } from "@/lib/auth/api-response";
import { requireAuthenticatedActor } from "@/lib/auth/session";
import { AuthenticationRequiredError } from "@/lib/domain/platform";
import { getMemoryRepository } from "@/lib/repositories/memory";
import { ConversationService } from "@/lib/services/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("rename"), title: z.string().min(1).max(120) }),
  z.object({ action: z.literal("pin"), pinned: z.boolean() }),
  z.object({ action: z.literal("archive") }),
  z.object({ action: z.literal("restore") }),
]);

/** 读取一条私人会话及完整原始历史；跨用户 ID 返回不存在。 */
export async function GET(request: Request, context: { params: { id: string } }) {
  try {
    const actor = await requireAuthenticatedActor();
    return json(await new ConversationService(getMemoryRepository()).get(actor.userId, context.params.id));
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) return authErrorResponse(error);
    return errorResponse(error);
  }
}

/** 重命名、置顶、归档或恢复会话；动作集合固定，不能透传任意字段更新。 */
export async function PATCH(request: Request, context: { params: { id: string } }) {
  try {
    const actor = await requireAuthenticatedActor();
    const input = updateSchema.parse(await request.json());
    const service = new ConversationService(getMemoryRepository());
    const conversation = input.action === "rename"
      ? await service.rename(actor.userId, context.params.id, input.title)
      : input.action === "pin"
        ? await service.setPinned(actor.userId, context.params.id, input.pinned)
        : input.action === "archive"
          ? await service.archive(actor.userId, context.params.id)
          : await service.restore(actor.userId, context.params.id);
    return json({ conversation });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) return authErrorResponse(error);
    return errorResponse(error);
  }
}

/** 软删除会话；物理数据保留策略由后台任务处理。 */
export async function DELETE(request: Request, context: { params: { id: string } }) {
  try {
    const actor = await requireAuthenticatedActor();
    await new ConversationService(getMemoryRepository()).remove(actor.userId, context.params.id);
    return json({ deleted: true });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) return authErrorResponse(error);
    return errorResponse(error);
  }
}
