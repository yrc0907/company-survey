import { NotFoundError, ValidationError } from "@/lib/domain/errors";

/** 上传对象不存在或不属于当前用户时使用统一 404，避免泄露其他用户的 Asset ID。 */
export class AssetNotFoundError extends NotFoundError {
  public constructor() { super("上传对象不存在"); this.name = "AssetNotFoundError"; }
}

/** 上传对象已存在或当前幂等键对应另一份对象。 */
export class AssetConflictError extends ValidationError {
  public constructor(message = "该上传已存在或正在处理") { super(message); this.name = "AssetConflictError"; }
}

/** 配额不足；不返回当前用户已有文件的明细。 */
export class AssetQuotaExceededError extends ValidationError {
  public constructor() { super("已超过个人上传配额"); this.name = "AssetQuotaExceededError"; }
}

/** OSS HEAD 与客户端声明不一致时不能把对象转入可解析状态。 */
export class AssetVerificationError extends ValidationError {
  public constructor(message = "上传对象校验失败，请重新上传") { super(message); this.name = "AssetVerificationError"; }
}

/** Worker 租约失效时丢弃晚到结果，避免两个 Worker 覆盖同一份解析产物。 */
export class IngestionLeaseLostError extends ValidationError {
  public constructor(message = "解析任务租约已失效，请等待任务重新排队") { super(message); this.name = "IngestionLeaseLostError"; }
}
