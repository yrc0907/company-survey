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
