import { ZodError } from "zod";

import { AccountConflictError, AuthenticationRequiredError, InvalidVerificationCodeError, PermissionDeniedError, VerificationProviderError, VerificationRateLimitError } from "@/lib/domain/platform";
import { json } from "@/lib/api/http";
import { NotFoundError, PersistenceRequiredError, ValidationError } from "@/lib/domain/errors";

/** 认证相关错误使用稳定状态码，且不把 SQL、哈希或 OAuth 响应写入客户端。 */
export function authErrorResponse(error: unknown) {
  if (error instanceof ZodError) return json({ error: "请求参数无效", code: "VALIDATION_ERROR", issues: error.flatten().fieldErrors }, { status: 400 });
  if (error instanceof SyntaxError) return json({ error: "请求 JSON 无法解析", code: "VALIDATION_ERROR" }, { status: 400 });
  if (error instanceof ValidationError) return json({ error: error.message, code: "VALIDATION_ERROR" }, { status: 400 });
  if (error instanceof AccountConflictError) return json({ error: error.message, code: "ACCOUNT_CONFLICT", field: error.field }, { status: 409 });
  if (error instanceof AuthenticationRequiredError) return json({ error: error.message, code: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  if (error instanceof PermissionDeniedError) return json({ error: error.message, code: "PERMISSION_DENIED" }, { status: 403 });
  if (error instanceof InvalidVerificationCodeError) return json({ error: error.message, code: "INVALID_VERIFICATION_CODE" }, { status: 400 });
  if (error instanceof VerificationRateLimitError) return json({ error: error.message, code: "RATE_LIMITED" }, { status: 429, headers: { "retry-after": "60" } });
  if (error instanceof VerificationProviderError) return json({ error: error.message, code: "PROVIDER_UNAVAILABLE" }, { status: 503 });
  if (error instanceof NotFoundError) return json({ error: error.message, code: "NOT_FOUND" }, { status: 404 });
  if (error instanceof PersistenceRequiredError) return json({ error: error.message, code: "PERSISTENCE_REQUIRED" }, { status: 409 });
  console.error("Platform auth API error", error);
  return json({ error: "服务暂时不可用", code: "INTERNAL_ERROR" }, { status: 500 });
}
