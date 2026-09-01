import { createHash } from "node:crypto";

import { CollaborationInvalidStateError } from "@/lib/domain/collaboration";

/**
 * 将协作写请求规范化为稳定指纹，避免同一个幂等键被重试请求偷偷复用为另一份内容。
 * 只在服务端调用；指纹本身不返回给客户端，也不包含密码、令牌或文件正文之外的秘密。
 */
export function collaborationIdempotencyFingerprint(scope: string, value: unknown): string {
  return createHash("sha256").update(`${scope}\0${stableSerialize(value)}`).digest("hex");
}

/** 统一限制幂等键长度，避免客户端把超大 Header 写入索引或日志。 */
export function readIdempotencyKey(request: Request): string | undefined {
  const value = request.headers.get("Idempotency-Key")?.trim() || undefined;
  if (value && value.length > 128) throw new CollaborationInvalidStateError("Idempotency-Key 不能超过 128 个字符");
  return value;
}

function stableSerialize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "undefined") return "undefined";
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => typeof entry !== "undefined")
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`).join(",")}}`;
  }
  return JSON.stringify(String(value));
}
