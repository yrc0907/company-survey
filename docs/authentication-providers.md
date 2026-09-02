# 真实身份认证接入

## 当前闭环

平台使用 Auth.js Credentials + 加密 JWT Session。邮箱/用户名密码认证已经存在；邮箱验证码、手机验证码、密码找回和图形验证由统一 `VerificationService` 编排，挑战记录写入 PostgreSQL `verification_challenge`，验证码只保存 HMAC，不保存明文。

认证请求的边界是：

```text
浏览器图形验证票据
  -> 服务端校验票据
  -> 账户/手机号权限校验
  -> 生成验证码并写入挑战表
  -> 阿里云短信或受控邮件 Provider（QQ/企业邮箱）
  -> Auth.js Credentials 消费一次性挑战
```

未知邮箱/手机号的登录和找回请求使用统一响应，避免账号枚举；验证码 60 秒内不可重发，最多尝试 5 次，过期或消费后不能重放。

## 服务器配置

真实值只放香港 ECS 的 `/srv/research-workbench/.env`，不写入仓库、镜像、日志或聊天：

```dotenv
EMAIL_PROVIDER=qq_mail # 或 aliyun_enterprise_mail
SMTP_HOST=smtp.qq.com # QQ；阿里云企业邮箱使用 smtp.qiye.aliyun.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_CONNECTION_TIMEOUT_MS=10000
SMTP_GREETING_TIMEOUT_MS=10000
SMTP_SOCKET_TIMEOUT_MS=15000
SMTP_USER=<专用发件账号>
SMTP_PASSWORD=<专用发件密码或应用密码>
EMAIL_FROM=<专用发件账号>

SMS_PROVIDER=aliyun_dypns
ALIYUN_SMS_API_URL=https://dypnsapi.aliyuncs.com/
ALIYUN_SMS_ACCESS_KEY_ID=<RAM AccessKeyId>
ALIYUN_SMS_ACCESS_KEY_SECRET=<RAM AccessKeySecret>
ALIYUN_SMS_SCHEME_NAME=research
ALIYUN_SMS_SIGN_NAME=恒创联众
ALIYUN_SMS_TEMPLATE_CODE=100001

CAPTCHA_REQUIRED=true
CAPTCHA_PROVIDER=aliyun
ALIYUN_CAPTCHA_API_URL=https://captcha.alicaptcha.com/validate
ALIYUN_CAPTCHA_APP_ID=<验证码方案 AppId>
ALIYUN_CAPTCHA_APP_KEY=<验证码方案 AppKey>
NEXT_PUBLIC_ALIYUN_CAPTCHA_APP_ID=<与服务端一致的 AppId>

# PostgreSQL 兜底限流（生产高并发时可替换同一接口为 Redis）
AUTH_RATE_LIMIT_WINDOW_SECONDS=3600
AUTH_RATE_LIMIT_DESTINATION_MAX=10
AUTH_RATE_LIMIT_IP_MAX=40
AUTH_RATE_LIMIT_DEVICE_MAX=20
```

阿里云号码认证服务使用 `Dypnsapi/2017-05-25` 的 `SendSmsVerifyCode` RPC，不是普通短信 `Dysmsapi/SendSms`。适配器用 RAM `AccessKeyId/AccessKeySecret` 做 HMAC-SHA1 签名，控制台方案名称通过 `SchemeName` 传入，挑战 UUID 作为 `OutId`，并对 429/5xx 或网络超时最多重试一次；签名名称和模板编码必须与控制台方案一致。若 Provider 未配置，页面显示明确的“服务未配置”错误，不伪造发送成功。生产配置前应轮换曾在截图或聊天中出现过的密钥。

迁移 `db/migrations/023_verification_rate_limits.sql` 建立 PostgreSQL 限流桶。服务端先完成图形验证，再用目标、IP、设备三维 HMAC key 原子消费一组桶；任一维度拒绝时整组不增加计数。清理任务可以按 `updated_at` 删除超过窗口的桶，不影响挑战历史。

## 邮箱 DNS

`webyrc.com` 的 MX 和 SPF 已验证。上线前仍需从企业邮箱控制台取得 DKIM selector 并在 ESA DNS 区添加 DKIM、DMARC；邮件主机记录保持 DNS-only，不能经过 CDN 代理。发信域、From 地址和 SPF/DKIM 必须对齐，否则验证邮件可能进入垃圾箱。

## 验收

- 注册后发送邮箱验证，验证后 `email_verified_at` 只允许正向写入。
- 已验证邮箱验证码登录成功建立同一 Auth.js Session。
- 已验证手机号验证码登录不能创建重复用户。
- 邮箱/手机号绑定与换绑写入追加式 `platform_identity_audit`；查询接口仅允许当前账户读取哈希、脱敏目标、挑战 ID、结果和时间，不返回目标原文。
- `email_change` 只接受已登录 Session，目标邮箱若属于其他账户在发码前拒绝；手机号换绑同样 fail-closed，数据库唯一索引是最终边界。
- 密码找回成功更新 Argon2id 哈希并解除旧锁定状态。
- 错误、过期、重复验证码和图形验证失败均不会建立 Session。
- Provider 超时、429、5xx 时记录失败状态，前端可回退密码登录。
- 限流桶拒绝、Provider 重试和挑战状态更新均可审计；不会把验证码或密钥写入日志。
- 不在测试、生产日志和 API 响应中输出验证码、密钥或完整目标地址。
