# 认证与邮件 DNS 预检

运行 `pnpm auth:readiness` 可只读检查 `AUTH_EMAIL_DOMAIN`/`DOMAIN`、`NEXTAUTH_SECRET`、邮箱/短信/图形验证 Provider，以及邮件域名的 MX、SPF、DKIM、DMARC。DKIM 需要额外设置 `DKIM_SELECTOR`。

脚本只输出 `configured/present/missing` 状态，不输出任何密钥、不发送消息。`ready_for_provider_test` 只代表 DNS 与变量齐全，不代表真实短信/邮件已经投递；真实联调仍要用最小额度执行注册验证、验证码登录和找回密码，并保存退信/供应商错误码。
