/** 评论附件允许的公开投影；下载地址由服务层按请求实时签发，数据库不保存 URL。 */
export interface CommentAttachmentSummary {
  id: string;
  commentId: string;
  assetId: string;
  filename: string;
  mimeType: string;
  size: number;
  downloadUrl: string | null;
  expiresInSeconds: number | null;
}

/** 仓储内部记录保留 OSS objectKey，不能直接序列化到浏览器。 */
export interface CommentAttachmentRecord extends Omit<CommentAttachmentSummary, "downloadUrl" | "expiresInSeconds"> {
  objectKey: string;
}

/** 评论附件仓储的窄接口；绑定操作在同一事务中校验资产归属与状态。 */
export interface CommentAttachmentRepository {
  listCommentAttachments(commentIds: string[]): Promise<CommentAttachmentRecord[]>;
  /** 创建评论前验证资产；只读，不创建任何关系。 */
  assertCommentAttachmentAssets(input: { projectId: string; assetIds: string[]; ownerUserId: string }): Promise<void>;
  attachCommentAttachments(input: { projectId: string; commentId: string; assetIds: string[]; ownerUserId: string }): Promise<CommentAttachmentRecord[]>;
}
