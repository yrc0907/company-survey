/** 协作写入失败的稳定错误码；API 只映射这些错误，不暴露 SQL。 */
export class CollaborationError extends Error {
  public constructor(public readonly code: string, message: string, public readonly details?: unknown) {
    super(message);
    this.name = "CollaborationError";
  }
}

export class CollaborationNotFoundError extends CollaborationError {
  public constructor(message = "协作对象不存在") { super("NOT_FOUND", message); this.name = "CollaborationNotFoundError"; }
}

export class CollaborationConflictError extends CollaborationError {
  public constructor(message = "目标分支已发生变化，请重新生成 Diff", details?: unknown) {
    super("VERSION_CONFLICT", message, details);
    this.name = "CollaborationConflictError";
  }
}

export class CollaborationInvalidStateError extends CollaborationError {
  public constructor(message = "当前协作状态不允许此操作") { super("INVALID_STATE", message); this.name = "CollaborationInvalidStateError"; }
}
