import { ValidationError } from "@/lib/domain/errors";

/** 头像专用约束：仅接收常见位图，拒绝携带 EXIF 的原始对象，避免 GPS/设备信息进入平台。 */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

function hasPrefix(buffer: Buffer, bytes: number[]): boolean {
  return bytes.every((value, index) => buffer[index] === value);
}

export function assertSafeAvatarBuffer(buffer: Buffer, mimeType: string, declaredSize: number): void {
  const mime = mimeType.trim().toLowerCase();
  if (!Number.isInteger(declaredSize) || declaredSize < 1 || declaredSize > AVATAR_MAX_BYTES || buffer.length !== declaredSize) throw new ValidationError("头像大小必须在 1 byte 到 2 MiB 之间");
  const valid = (mime === "image/jpeg" && hasPrefix(buffer, [0xff, 0xd8, 0xff]))
    || (mime === "image/png" && hasPrefix(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    || (mime === "image/webp" && hasPrefix(buffer, [0x52, 0x49, 0x46, 0x46]) && buffer.subarray(8, 12).toString("ascii") === "WEBP")
    || (mime === "image/gif" && (buffer.subarray(0, 6).toString("ascii") === "GIF87a" || buffer.subarray(0, 6).toString("ascii") === "GIF89a"));
  if (!valid) throw new ValidationError("头像 MIME 与文件签名不匹配");
  // JPEG APP1/Exif、PNG eXIf、WebP EXIF 均可能携带 GPS/设备信息；在没有可信重编码器时拒绝而非原样保存。
  if ((mime === "image/jpeg" && buffer.includes(Buffer.from("Exif\0\0", "ascii"))) || (mime === "image/png" && buffer.includes(Buffer.from("eXIf", "ascii"))) || (mime === "image/webp" && buffer.subarray(12).includes(Buffer.from("EXIF", "ascii")))) {
    throw new ValidationError("头像包含 EXIF 元数据，请先移除后再上传");
  }
}

