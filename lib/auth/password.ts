import { hash, verify } from "@node-rs/argon2";

import type { PasswordHasher } from "@/lib/services/platform/account-service";

/**
 * Argon2id 密码适配器。参数按公开 Web 服务的内存约束设置；哈希自带随机 salt。
 * 副作用是消耗受限 CPU/内存，不写日志，严禁记录明文密码。
 */
export const argon2idPasswordHasher: PasswordHasher = {
  // @node-rs/argon2 的默认算法即 Argon2id；不引用 ambient const enum，兼容 isolatedModules。
  hash: (value) => hash(value, { memoryCost: 19_456, timeCost: 2, parallelism: 1, outputLen: 32 }),
  verify: (encoded, value) => verify(encoded, value),
};
