# 真实身份认证接入

## 当前闭环

平台使用 Auth.js Credentials + 加密 JWT Session。邮箱/用户名密码认证已经存在；邮箱验证码、手机验证码、密码找回和图形验证由统一 `VerificationService` 编排，挑战记录写入 PostgreSQL `verification_challenge`，验证码只保存 HMAC，不保存明文。

认证请求的边界是：

```text
浏览器图形验证票据
  -> 服务端校验票据
  -> 账户/手机号权限校验
  -> 生成验证码并写入挑战表
  -> 阿里云短信或企业邮箱 Provider
  -> Auth.js Credentials 消费一次性挑战
```

未知邮箱/手机号的登录和找回请求使用统一响应，避免账号枚举；验证码 60 秒内不可重发，最多尝试 5 次，过期或消费后不能重放。

## 服务器配置

真实值只放香港 ECS 的 `/srv/research-workbench/.env`，不写入仓库、镜像、日志或聊天：

```dotenv
EMAIL_PROVIDER=aliyun_enterprise_mail
SMTP_HOST=<阿里云企业邮箱 SMTP 主机>
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=<专用发件账号>
SMTP_PASSWORD=<专用发件密码或应用密码>
EMAIL_FROM=<专用发件账号>

SMS_PROVIDER=aliyun_dypns
ALIYUN_SMS_API_URL=<控制台对应的短信认证 API 端点>
ALIYUN_SMS_APP_ID=<appId>
ALIYUN_SMS_APP_KEY=<appKey>
ALIYUN_SMS_SCHEME_CODE=<方案编码>
ALIYUN_SMS_SIGN_NAME=恒创联众
ALIYUN_SMS_TEMPLATE_CODE=100001

CAPTCHA_REQUIRED=true
CAPTCHA_PROVIDER=aliyun
ALIYUN_CAPTCHA_API_URL=<图形验证服务端校验端点>
ALIYUN_CAPTCHA_APP_ID=<验证码方案 AppId>
ALIYUN_CAPTCHA_APP_KEY=<验证码方案 AppKey>
NEXT_PUBLIC_ALIYUN_CAPTCHA_SCENE_ID=<前端场景 ID>
```

阿里云短信认证服务的具体 API 端点和返回字段以当前控制台/SDK 文档为准，适配器不把 Provider 响应直接返回客户端。若 Provider 未配置，页面显示明确的“服务未配置”错误，不伪造发送成功。生产配置前应轮换曾在截图或聊天中出现过的密钥。

## 邮箱 DNS

`webyrc.com` 的 MX 和 SPF 已验证。上线前仍需从企业邮箱控制台取得 DKIM selector 并在 ESA DNS 区添加 DKIM、DMARC；邮件主机记录保持 DNS-only，不能经过 CDN 代理。发信域、From 地址和 SPF/DKIM 必须对齐，否则验证邮件可能进入垃圾箱。

## 验收

- 注册后发送邮箱验证，验证后 `email_verified_at` 只允许正向写入。
- 已验证邮箱验证码登录成功建立同一 Auth.js Session。
- 已验证手机号验证码登录不能创建重复用户。
- 密码找回成功更新 Argon2id 哈希并解除旧锁定状态。
- 错误、过期、重复验证码和图形验证失败均不会建立 Session。
- Provider 超时、429、5xx 时记录失败状态，前端可回退密码登录。
- 不在测试、生产日志和 API 响应中输出验证码、密钥或完整目标地址。
