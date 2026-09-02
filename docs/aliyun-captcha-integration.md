# 阿里云验证码 4.0（H5）

前端只读取 `NEXT_PUBLIC_ALIYUN_CAPTCHA_APP_ID`，加载 `https://static.alicaptcha.com/v4/ct4.js` 并调用 `initAlicom4({ captchaId: appId, product: "bind" })`。成功后调用 `getValidate()`，将 `lot_number`、`captcha_output`、`pass_token`、`gen_time` JSON 作为一次性票据提交服务端。

服务端从私有环境读取 `ALIYUN_CAPTCHA_APP_ID` 与 `ALIYUN_CAPTCHA_APP_KEY`，向 `https://captcha.alicaptcha.com/validate?captcha_id=appId` 发送 form：四个票据字段及 `sign_token=HMAC-SHA256(appKey, lot_number)`。超时、非 2xx、JSON 非 success 或字段缺失均 fail-closed。不要把 AppKey 写入浏览器、仓库或日志。

