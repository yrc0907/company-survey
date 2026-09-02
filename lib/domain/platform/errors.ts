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
  public constructor(public readonly field: "email" | "phone" | "username" | "identity", message: string) {
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

/** 验证码错误不区分不存在、过期和错误次数耗尽，避免泄漏挑战状态。 */
export class InvalidVerificationCodeError extends Error {
  public constructor() {
    super("验证码无效或已过期");
    this.name = "InvalidVerificationCodeError";
  }
}

/** 发送频率超过策略时返回统一可恢复错误；具体窗口不暴露内部限流实现。 */
export class VerificationRateLimitError extends Error {
  public constructor(message = "操作过于频繁，请稍后再试") {
    super(message);
    this.name = "VerificationRateLimitError";
  }
}

/** 外部邮件、短信或图形验证服务不可用；不把供应商响应泄漏给客户端。 */
export class VerificationProviderError extends Error {
  public constructor(message = "验证服务暂时不可用") {
    super(message);
    this.name = "VerificationProviderError";
  }
}
