import { z } from "zod";

import { errorResponse, json } from "@/lib/api/http";
import { authErrorResponse } from "@/lib/auth/api-response";
import { requireAuthenticatedActor } from "@/lib/auth/session";
import { AuthenticationRequiredError } from "@/lib/domain/platform";
import { getMemoryRepository } from "@/lib/repositories/memory";
import { ConversationService } from "@/lib/services/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  title: z.string().max(120).optional(),
  projectId: z.string().max(200).optional(),
  branchId: z.string().max(200).optional(),
  parentConversationId: z.string().max(200).optional(),
  parentMessageId: z.string().max(200).optional(),
});

/** 创建私人 AI 会话；owner 只来自服务端 ActorResolver。 */
export async function POST(request: Request) {
  try {
    const actor = await requireAuthenticatedActor();
    const input = createSchema.parse(await request.json());
    const conversation = await new ConversationService(getMemoryRepository()).create({ ownerUserId: actor.userId, ...input });
    return json({ conversation }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) return authErrorResponse(error);
    return errorResponse(error);
  }
}

/** 列出当前用户历史会话；支持项目、状态和全文查询，不接受客户端 owner ID。 */
export async function GET(request: Request) {
  try {
    const actor = await requireAuthenticatedActor();
    const url = new URL(request.url);
    const rawStatus = url.searchParams.get("status");
    const status = rawStatus === "archived" ? "archived" as const : "active" as const;
    const conversations = await new ConversationService(getMemoryRepository()).list({
      ownerUserId: actor.userId,
      status,
      projectId: url.searchParams.get("projectId") ?? undefined,
      query: url.searchParams.get("q") ?? undefined,
      limit: Number(url.searchParams.get("limit") ?? 30),
      offset: Number(url.searchParams.get("offset") ?? 0),
    });
    return json({ conversations });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) return authErrorResponse(error);
    return errorResponse(error);
  }
}
