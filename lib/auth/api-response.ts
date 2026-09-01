import { ZodError } from "zod";

import { AccountConflictError, AuthenticationRequiredError, PermissionDeniedError } from "@/lib/domain/platform";
import { json } from "@/lib/api/http";
import { ValidationError } from "@/lib/domain/errors";

/** 认证相关错误使用稳定状态码，且不把 SQL、哈希或 OAuth 响应写入客户端。 */
export function authErrorResponse(error: unknown) {
  if (error instanceof ZodError) return json({ error: "请求参数无效", code: "VALIDATION_ERROR", issues: error.flatten().fieldErrors }, { status: 400 });
  if (error instanceof SyntaxError) return json({ error: "请求 JSON 无法解析", code: "VALIDATION_ERROR" }, { status: 400 });
  if (error instanceof ValidationError) return json({ error: error.message, code: "VALIDATION_ERROR" }, { status: 400 });
  if (error instanceof AccountConflictError) return json({ error: error.message, code: "ACCOUNT_CONFLICT", field: error.field }, { status: 409 });
  if (error instanceof AuthenticationRequiredError) return json({ error: error.message, code: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  if (error instanceof PermissionDeniedError) return json({ error: error.message, code: "PERMISSION_DENIED" }, { status: 403 });
  console.error("Platform auth API error", error);
  return json({ error: "服务暂时不可用", code: "INTERNAL_ERROR" }, { status: 500 });
}
