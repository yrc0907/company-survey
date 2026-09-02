# 阿里云认证接入决策（2026-09-02）

## 最终选择

本项目采用三条独立能力：

1. **阿里云短信认证服务**：只使用控制台提供的默认验证码模板和认证方案，不接普通短信服务的自定义 `SendSms` 模板，也不把普通短信 API 作为本项目的前提。
2. **阿里云企业邮箱**：用于注册邮箱验证、邮箱验证码登录、密码找回和邮箱换绑；发信使用专用邮箱账号的 SMTP。
3. **阿里云图形验证**：用于注册、发送邮箱/短信验证码前的人机校验；浏览器只提交一次性票据，服务端再次校验。

“短信认证服务”和“普通短信服务”是两套产品。普通短信文档里的 `dysmsapi.aliyuncs.com / SendSms / SMS_...` 参数不能套用到短信认证服务的默认模板。短信认证服务使用 `dypnsapi.aliyuncs.com / SendSmsVerifyCode`，`SchemeName` 是控制台的方案名称（本项目为 `research`）；endpoint 和请求字段以该产品当前 SDK 文档为准，适配器通过统一 Provider 接口隔离。

## 配置字段（只允许出现在香港 ECS `.env`）

### 短信认证服务

```env
SMS_PROVIDER=aliyun_dypns
ALIYUN_SMS_API_URL=<短信认证服务官方 endpoint>
ALIYUN_SMS_ACCESS_KEY_ID=<RAM AccessKey ID>
ALIYUN_SMS_ACCESS_KEY_SECRET=<RAM AccessKey Secret>
ALIYUN_SMS_SCHEME_NAME=research
ALIYUN_SMS_TIMEOUT_MS=8000
```

RAM 的 `AccessKeyId/AccessKeySecret` 是云 API 的签名凭据；RAM 用户 ID 只是身份编号，不能当作密钥。密钥只由后端读取，不能进浏览器、Git、文档或日志。

### 企业邮箱 SMTP

```env
EMAIL_PROVIDER=aliyun_enterprise_mail
SMTP_HOST=<企业邮箱客户端配置中的 SMTP 主机>
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=<专用发件邮箱账号>
SMTP_PASSWORD=<专用发件账号密码或应用密码>
EMAIL_FROM=<与 SMTP_USER 对齐的发件地址>
```

网页邮箱的“收信和发信”设置不是 SMTP 接口页面。SMTP 主机以企业邮箱客户端配置/官方帮助为准；正式使用建议创建 `no-reply@webyrc.com`，不使用 `postmaster` 管理员账号作为长期发件人。

### 图形验证

```env
CAPTCHA_REQUIRED=true
CAPTCHA_PROVIDER=aliyun
ALIYUN_CAPTCHA_API_URL=<图形验证服务端校验 endpoint>
ALIYUN_CAPTCHA_APP_ID=<验证码方案 AppId>
ALIYUN_CAPTCHA_APP_KEY=<验证码方案 AppKey>
NEXT_PUBLIC_ALIYUN_CAPTCHA_SCENE_ID=<前端集成 SceneId>
```

图形验证控制台显示的“方案编码”不自动等同于前端 `SceneId`；必须按阿里云集成页面确认两者映射。AppKey 只放服务端，`SceneId` 才能作为前端公开配置。

## 业务链路

```text
注册/登录/找回/换绑
  -> 图形验证票据（服务端校验）
  -> 目标、IP、设备限流
  -> 创建一次性 verification_challenge
  -> 邮箱 SMTP 或短信认证 Provider
  -> 消费验证码并建立 Auth.js Session
```

验证码只保存哈希、用途、过期时间、尝试次数、消费时间和供应商消息 ID。Provider 超时、429、5xx、票据重复、验证码过期或冲突时 fail-closed；失败不能显示“发送成功”。

## 验收顺序

1. 先运行 `pnpm auth:readiness`，确认环境变量和邮箱 DNS 状态；该命令不发送消息、不输出密钥。
2. 用企业邮箱专用账号发送一封验证邮件，确认收件、退信和 SMTP 超时状态。
3. 使用短信认证服务的控制台测试号码发送一条默认模板验证码；不得使用普通短信 `SendSms` 参数替代。
4. 使用图形验证真实票据分别覆盖成功、过期、重复和服务超时。
5. 回归注册、邮箱验证码登录、短信认证登录、找回密码、邮箱/手机号换绑、错误/过期/重复验证码和供应商 429/5xx。

## 凭据安全

本轮对话或截图中出现过的邮箱密码、AppKey、AccessKey Secret 均视为已暴露，正式联调前应在阿里云后台轮换。代码、Docker 镜像、GitHub/Gitee、日志和客户端 Bundle 永远不保存这些值；服务器 `.env` 权限必须为 `600`。
