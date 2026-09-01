import { z } from "zod";

import { errorResponse, json } from "@/lib/api/http";
import { authErrorResponse } from "@/lib/auth/api-response";
import { requireAuthenticatedActor } from "@/lib/auth/session";
import { AuthenticationRequiredError } from "@/lib/domain/platform";
import { getMemoryRepository } from "@/lib/repositories/memory";
import { ConversationService } from "@/lib/services/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const messageSchema = z.object({
  role: z.enum(["user", "assistant", "tool"]),
  content: z.string().min(1).max(200_000),
  parentMessageId: z.string().max(200).optional(),
  metadata: z.record(z.unknown()).optional(),
});

/** 追加原始消息事件；system 规则不能由客户端写入。 */
export async function POST(request: Request, context: { params: { id: string } }) {
  try {
    const actor = await requireAuthenticatedActor();
    const input = messageSchema.parse(await request.json());
    const message = await new ConversationService(getMemoryRepository()).appendMessage({
      ownerUserId: actor.userId,
      conversationId: context.params.id,
      ...input,
    });
    return json({ message }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) return authErrorResponse(error);
    return errorResponse(error);
  }
}
