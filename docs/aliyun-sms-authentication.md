# 阿里云短信认证服务

本项目的手机验证码通道使用阿里云号码认证服务（Dypnsapi），调用 `SendSmsVerifyCode`，不是普通短信推送的 `Dysmsapi/SendSms`。

服务端配置：

```dotenv
SMS_PROVIDER=aliyun_dypns
ALIYUN_SMS_API_URL=https://dypnsapi.aliyuncs.com/
ALIYUN_SMS_ACCESS_KEY_ID=<RAM AccessKeyId>
ALIYUN_SMS_ACCESS_KEY_SECRET=<RAM AccessKeySecret>
ALIYUN_SMS_SCHEME_NAME=research
ALIYUN_SMS_SIGN_NAME=<控制台签名名称>
ALIYUN_SMS_TEMPLATE_CODE=100001
```

Provider 使用 `Dypnsapi/2017-05-25` RPC 参数和 HMAC-SHA1 签名。验证码放在 `TemplateParam` 的 `code`/`min` 字段，挑战 UUID 作为 `OutId`，重试时复用同一请求参数。默认端点只允许 HTTPS 覆盖；缺少 RAM 凭据或方案名称时保持未配置，不伪造发送成功。

对 429、5xx 和网络超时最多重试一次。Provider 只返回脱敏后的消息 ID，阿里云错误正文不会透传到客户端。生产环境应使用最小权限 RAM 身份或实例绑定的 RAM 角色，并且不要把 AccessKey 写入仓库、镜像、日志或聊天。
