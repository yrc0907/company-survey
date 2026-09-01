import { z } from "zod";

import { authErrorResponse } from "@/lib/auth/api-response";
import { requireAuthenticatedActor } from "@/lib/auth/session";
import { json } from "@/lib/api/http";
import { getPlatformRepository } from "@/lib/repositories/platform/platform-repository-factory";
import { AuthorizationService } from "@/lib/services/platform/authorization-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  projectId: z.string().trim().min(1).max(128),
  branchId: z.string().trim().min(1).max(128).optional(),
  action: z.enum(["read_published", "read_draft", "create_branch", "write_branch", "submit_merge_request", "review_merge_request", "merge", "manage_project"]),
}).superRefine((value, context) => {
  if (["read_draft", "write_branch", "submit_merge_request"].includes(value.action) && !value.branchId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["branchId"], message: "该动作必须指定分支" });
  }
});

/** 返回当前用户针对单个项目动作的授权结果；拒绝时不泄漏项目私有元数据。 */
export async function GET(request: Request) {
  try {
    const actor = await requireAuthenticatedActor();
    const url = new URL(request.url);
    const input = querySchema.parse({ projectId: url.searchParams.get("projectId"), branchId: url.searchParams.get("branchId") ?? undefined, action: url.searchParams.get("action") });
    const authorization = new AuthorizationService(getPlatformRepository());
    if (input.action === "read_draft" || input.action === "write_branch" || input.action === "submit_merge_request") {
      await authorization.assertBranchAction(actor, input.projectId, input.branchId!, input.action);
    } else {
      await authorization.assertProjectAction(actor, input.projectId, input.action);
    }
    return json({ allowed: true, projectId: input.projectId, branchId: input.branchId, action: input.action });
  } catch (error) {
    return authErrorResponse(error);
  }
}
