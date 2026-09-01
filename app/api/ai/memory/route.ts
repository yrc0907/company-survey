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

const createSchema = z.object({
  projectId: z.string().max(200).optional(),
  conversationId: z.string().max(200).optional(),
  scope: z.enum(["user", "project", "conversation"]),
  category: z.enum(["preference", "identity", "decision", "todo"]),
  content: z.string().min(1).max(20_000),
  state: z.enum(["candidate", "active"]).optional(),
  importance: z.number().min(0).max(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
  validUntil: z.string().datetime().optional(),
  sources: z.array(sourceSchema).min(1).max(20),
});

/** 创建可追溯长期记忆；owner 只来自服务端 Session。 */
export async function POST(request: Request) {
  try {
    const actor = await requireAuthenticatedActor();
    const input = createSchema.parse(await request.json());
    const memory = await new MemoryManagementService(getMemoryRepository()).create({ ownerUserId: actor.userId, ...input });
    return json({ memory }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) return authErrorResponse(error);
    return errorResponse(error);
  }
}

/** 列出当前用户允许管理的记忆；默认不返回已删除记录。 */
export async function GET(request: Request) {
  try {
    const actor = await requireAuthenticatedActor();
    const url = new URL(request.url);
    const repository = getMemoryRepository();
    const memories = await repository.listMemories({
      ownerUserId: actor.userId,
      projectId: url.searchParams.get("projectId"),
      conversationId: url.searchParams.get("conversationId"),
      query: url.searchParams.get("q") ?? "",
      now: new Date().toISOString(),
      limit: Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 50))),
    });
    return json({ memories });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) return authErrorResponse(error);
    return errorResponse(error);
  }
}
