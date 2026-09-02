# 阿里云企业邮箱认证联调

阿里云企业邮箱认证邮件使用 `EMAIL_PROVIDER=aliyun_enterprise_mail`。QQ 邮箱使用同一 SMTP 适配器但配置为 `EMAIL_PROVIDER=qq_mail`；不接受未列入白名单的普通 SMTP Provider。授权码只保存在服务器环境中。

服务器 `.env` 需要填写：

```dotenv
EMAIL_PROVIDER=aliyun_enterprise_mail
SMTP_HOST=<企业邮箱 SMTP 主机>
SMTP_PORT=465
SMTP_SECURE=true
SMTP_CONNECTION_TIMEOUT_MS=10000
SMTP_GREETING_TIMEOUT_MS=10000
SMTP_SOCKET_TIMEOUT_MS=15000
SMTP_USER=<专用发件账号>
SMTP_PASSWORD=<专用发件密码或应用专用密码>
EMAIL_FROM=<与 SMTP_USER 同域的发件地址>
```

应用只读取运行时 `SMTP_PASSWORD`，不会回显、写日志或提交 Git。`EMAIL_FROM` 必须与 `SMTP_USER` 使用同一发信域；连接、握手、套接字超时的合法范围是 1–120 秒，非法值回退到安全默认值。

SMTP 接受不等于最终投递成功。生产应在企业邮箱控制台配置投递状态/退信回执，并用 message-id 关联 `verification_challenge.provider_message_id`；退信只标记挑战失败或通知人工，不重复发送同一验证码。

联调顺序：

1. `pnpm exec tsx lib/providers/auth/email-provider.contract.ts`
2. 在控制台确认 MX、SPF、DKIM、DMARC 与发信域对齐。
3. 使用最小额度依次验证注册邮箱、邮箱验证码登录、密码找回和邮箱换绑。
4. 保存投递成功与退信原因，不保存邮件密码、验证码或完整目标地址。
