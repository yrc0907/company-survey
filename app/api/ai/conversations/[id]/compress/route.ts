import { errorResponse, json } from "@/lib/api/http";
import { authErrorResponse } from "@/lib/auth/api-response";
import { requireAuthenticatedActor } from "@/lib/auth/session";
import { AuthenticationRequiredError } from "@/lib/domain/platform";
import { getMemoryRepository } from "@/lib/repositories/memory";
import { ConversationCompactionService, DeterministicSummaryProvider } from "@/lib/services/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 手动建立结构化压缩检查点；原始消息不删除，连续失败会熔断。 */
export async function POST(request: Request, context: { params: { id: string } }) {
  try {
    const actor = await requireAuthenticatedActor();
    const result = await new ConversationCompactionService(getMemoryRepository(), new DeterministicSummaryProvider()).compact({
      ownerUserId: actor.userId,
      conversationId: context.params.id,
    });
    return json(result, { status: 201 });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) return authErrorResponse(error);
    return errorResponse(error);
  }
}
