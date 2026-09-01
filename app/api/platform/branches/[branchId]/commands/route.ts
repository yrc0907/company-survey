import { z } from "zod";

import { authErrorResponse } from "@/lib/auth/api-response";
import { requireAuthenticatedActor } from "@/lib/auth/session";
import { assertTrustedJsonRequest } from "@/lib/auth/request-security";
import { json } from "@/lib/api/http";
import { collaborationErrorResponse, CollaborationService } from "@/lib/services/collaboration";
import { getCollaborationRepository } from "@/lib/repositories/collaboration";
import { getPlatformRepository } from "@/lib/repositories/platform/platform-repository-factory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const commandSchema = z.object({ command: z.discriminatedUnion("type", [z.object({ type: z.literal("create_node"), parentId: z.string().nullable(), kind: z.enum(["folder", "document"]), name: z.string() }), z.object({ type: z.literal("rename_node"), nodeId: z.string(), name: z.string() }), z.object({ type: z.literal("move_node"), nodeId: z.string(), parentId: z.string().nullable() }), z.object({ type: z.literal("delete_node"), nodeId: z.string() }), z.object({ type: z.literal("restore_node"), nodeId: z.string() }), z.object({ type: z.literal("duplicate_node"), nodeId: z.string(), parentId: z.string().nullable(), name: z.string().optional() })]), message: z.string().trim().max(300).optional(), aiAssisted: z.boolean().optional(), expectedVersion: z.number().int().nonnegative().optional() }).strict();

/** 文件树所有写入均走 KnowledgeCommandRegistry，提交后返回 immutable Commit。 */
export async function POST(request: Request, context: { params: { branchId: string } }) {
  try { assertTrustedJsonRequest(request); const actor = await requireAuthenticatedActor(); const input = commandSchema.parse(await request.json()); const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() || undefined; const result = await new CollaborationService(getCollaborationRepository(), getPlatformRepository()).executeCommand({ branchId: context.params.branchId, command: input.command, message: input.message, aiAssisted: input.aiAssisted, expectedVersion: input.expectedVersion, idempotencyKey }, actor); return json(result, { status: result.replayed ? 200 : 201 }); }
  catch (error) { return collaborationErrorResponse(error) ?? authErrorResponse(error); }
}
