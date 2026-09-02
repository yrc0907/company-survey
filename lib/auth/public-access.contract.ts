import assert from "node:assert/strict";

import { isPublicAuthEnabled, PUBLIC_AUTH_CLOSED_MESSAGE } from "@/lib/auth/public-access";

assert.equal(isPublicAuthEnabled({ NODE_ENV: "production" }), false, "生产未配置时必须默认关闭认证入口");
assert.equal(isPublicAuthEnabled({ NODE_ENV: "development" }), true, "开发环境未配置时保留认证能力便于测试");
assert.equal(isPublicAuthEnabled({ NODE_ENV: "production", PUBLIC_AUTH_ENABLED: "true" }), true);
assert.equal(isPublicAuthEnabled({ NODE_ENV: "production", PUBLIC_AUTH_ENABLED: "false", NEXT_PUBLIC_PUBLIC_AUTH_ENABLED: "true" }), false, "服务端开关优先于客户端构建变量");
assert.equal(PUBLIC_AUTH_CLOSED_MESSAGE, "登录功能暂未开放，仅对内测用户开放");
console.log("public auth access contract: passed");
