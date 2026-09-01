import { ZodError } from "zod";

import { json } from "@/lib/api/http";
import { NotFoundError, ValidationError } from "@/lib/domain/errors";
import { AuthenticationRequiredError, PermissionDeniedError } from "@/lib/domain/platform";

/** 上传 API 只向客户端返回可处理的错误码，不泄露 OSS、SQL、凭据或对象路径细节。 */
export function assetErrorResponse(error: unknown) {
  if (error instanceof ZodError) return json({ error: "请求参数无效", code: "VALIDATION_ERROR", issues: error.flatten().fieldErrors }, { status: 400 });
  if (error instanceof SyntaxError) return json({ error: "请求 JSON 无法解析", code: "VALIDATION_ERROR" }, { status: 400 });
  if (error instanceof AuthenticationRequiredError) return json({ error: error.message, code: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  if (error instanceof PermissionDeniedError) return json({ error: error.message, code: "PERMISSION_DENIED" }, { status: 403 });
  if (error instanceof NotFoundError) return json({ error: error.message, code: "NOT_FOUND" }, { status: 404 });
  if (error instanceof ValidationError) return json({ error: error.message, code: "VALIDATION_ERROR" }, { status: 400 });
  console.error("Platform asset API error", error);
  return json({ error: "上传服务暂时不可用", code: "INTERNAL_ERROR" }, { status: 500 });
}
