import { z } from "zod";

import { errorResponse, json } from "@/lib/api/http";
import { authErrorResponse } from "@/lib/auth/api-response";
import { requireAuthenticatedActor } from "@/lib/auth/session";
import { AuthenticationRequiredError } from "@/lib/domain/platform";
import { getMemoryRepository } from "@/lib/repositories/memory";
import { MemoryManagementService } from "@/lib/services/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sourceSchema = z.object({
  sourceType: z.enum(["message", "commit", "citation", "explicit_user"]),
  sourceId: z.string().min(1).max(200),
  extractionMode: z.enum(["explicit", "automatic_candidate", "manual_review"]),
});

const updateSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("state"), state: z.enum(["candidate", "active", "disabled", "expired"]) }),
  z.object({ action: z.literal("supersede"), content: z.string().min(1).max(20_000), reason: z.string().min(1).max(500), sources: z.array(sourceSchema).min(1).max(20) }),
]);

/** 启用/禁用/过期记忆或追加 supersession 版本；旧版本不可变。 */
export async function PATCH(request: Request, context: { params: { id: string } }) {
  try {
    const actor = await requireAuthenticatedActor();
    const input = updateSchema.parse(await request.json());
    const service = new MemoryManagementService(getMemoryRepository());
    const memory = input.action === "state"
      ? await service.setState(actor.userId, context.params.id, input.state)
      : await service.supersede({ ownerUserId: actor.userId, memoryId: context.params.id, content: input.content, reason: input.reason, sources: input.sources });
    return json({ memory });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) return authErrorResponse(error);
    return errorResponse(error);
  }
}

/** 软删除长期记忆并停止后续注入；物理清理由数据保留任务完成。 */
export async function DELETE(request: Request, context: { params: { id: string } }) {
  try {
    const actor = await requireAuthenticatedActor();
    await new MemoryManagementService(getMemoryRepository()).setState(actor.userId, context.params.id, "deleted");
    return json({ deleted: true });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) return authErrorResponse(error);
    return errorResponse(error);
  }
}
