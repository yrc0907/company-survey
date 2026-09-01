/** 未建立有效会话。 */
export class AuthenticationRequiredError extends Error {
  public constructor(message = "请先登录") {
    super(message);
    this.name = "AuthenticationRequiredError";
  }
}

/** 已登录但没有执行目标操作的项目权限。 */
export class PermissionDeniedError extends Error {
  public constructor(message = "没有执行此操作的权限") {
    super(message);
    this.name = "PermissionDeniedError";
  }
}

/** 用户名、邮箱或 OAuth 身份与现有数据冲突。 */
export class AccountConflictError extends Error {
  public constructor(public readonly field: "email" | "username" | "identity", message: string) {
    super(message);
    this.name = "AccountConflictError";
  }
}

/** 登录凭据无效；错误信息刻意不区分账号不存在和密码错误。 */
export class InvalidCredentialsError extends Error {
  public constructor() {
    super("账号或密码错误");
    this.name = "InvalidCredentialsError";
  }
}
