import { NextResponse } from "next/server";

import { NotFoundError, PersistenceRequiredError, ValidationError, VersionConflictError } from "@/lib/domain/errors";

/** 统一返回 JSON，避免 API 将内部异常堆栈或环境变量泄漏给客户端。 */
export function json(data: unknown, init: ResponseInit = {}): NextResponse {
  return NextResponse.json(data, init);
}

/** 将领域错误映射为前端可恢复的 HTTP 错误，不暴露数据库或 Provider 细节。 */
export function errorResponse(error: unknown): NextResponse {
  if (error instanceof ValidationError) {
    return json({ error: error.message, code: "VALIDATION_ERROR" }, { status: 400 });
  }
  if (error instanceof NotFoundError) {
    return json({ error: error.message, code: "NOT_FOUND" }, { status: 404 });
  }
  if (error instanceof VersionConflictError) {
    return json({ error: error.message, code: "VERSION_CONFLICT", expectedVersion: error.expectedVersion, actualVersion: error.actualVersion }, { status: 409 });
  }
  if (error instanceof PersistenceRequiredError) {
    return json({ error: error.message, code: "PERSISTENCE_REQUIRED" }, { status: 409 });
  }

  console.error("Research Workbench API error", error);
  return json({ error: "服务暂时不可用", code: "INTERNAL_ERROR" }, { status: 500 });
}
