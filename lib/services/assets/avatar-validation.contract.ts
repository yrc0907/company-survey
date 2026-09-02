import assert from "node:assert/strict";
import { assertSafeAvatarBuffer } from "@/lib/services/assets/avatar-validation";

function run(): void {
  assertSafeAvatarBuffer(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image/png", 8);
  assert.throws(() => assertSafeAvatarBuffer(Buffer.from("not-image"), "image/png", 9), /签名不匹配/);
  const jpegExif = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0x45]), Buffer.from([0x45, 0x78, 0x69, 0x66, 0, 0])]);
  assert.throws(() => assertSafeAvatarBuffer(jpegExif, "image/jpeg", jpegExif.length), /EXIF/);
  assert.throws(() => assertSafeAvatarBuffer(Buffer.alloc(2 * 1024 * 1024 + 1), "image/png", 2 * 1024 * 1024 + 1), /2 MiB/);
  console.log("avatar validation contract: passed");
}

run();
