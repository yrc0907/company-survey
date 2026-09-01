import { ZodError } from "zod";

import { json } from "@/lib/api/http";
import { CollaborationError } from "@/lib/domain/collaboration";

/** 协作 API 的稳定错误映射；不把数据库异常、权限细节或对象存储信息返回给客户端。 */
export function collaborationErrorResponse(error: unknown) {
  if (error instanceof ZodError) return json({ error: "请求参数无效", code: "VALIDATION_ERROR", issues: error.flatten().fieldErrors }, { status: 400 });
  if (error instanceof SyntaxError) return json({ error: "请求 JSON 无法解析", code: "VALIDATION_ERROR" }, { status: 400 });
  if (error instanceof CollaborationError) return json({ error: error.message, code: error.code, details: error.details }, { status: error.code === "NOT_FOUND" ? 404 : error.code === "VERSION_CONFLICT" ? 409 : error.code === "INVALID_STATE" ? 409 : 400 });
  return null;
}
