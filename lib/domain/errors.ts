/** 调研服务的显式错误类型，API 可据此返回稳定且不泄漏内部实现的状态码。 */

/** 请求的对象不存在或不属于当前工作台。 */
export class NotFoundError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

/** 乐观锁冲突，客户端必须加载最新版本后再人工决定如何合并。 */
export class VersionConflictError extends Error {
  public constructor(public readonly expectedVersion: number, public readonly actualVersion: number) {
    super(`报告版本冲突：期望 v${expectedVersion}，当前为 v${actualVersion}`);
    this.name = "VersionConflictError";
  }
}

/** 不可信来源、无效参数或越权访问导致的安全拒绝。 */
export class ValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/** 只读演示数据不能伪装成持久化写入，调用方必须先连接 PostgreSQL。 */
export class PersistenceRequiredError extends Error {
  public constructor(message = "当前为内存演示模式；连接 PostgreSQL 后才能写入资料。") {
    super(message);
    this.name = "PersistenceRequiredError";
  }
}
