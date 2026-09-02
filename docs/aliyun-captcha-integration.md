# 阿里云图形验证配置

控制台方案 `research` 的 `SceneId` 必须复制到 `ALIYUN_CAPTCHA_SCENE_ID` 与 `NEXT_PUBLIC_ALIYUN_CAPTCHA_SCENE_ID`。服务端还需要同一方案的 `AppId`、`AppKey`；这两个字段只能写入 ECS 私有 `.env`，不能进入浏览器 bundle、仓库或日志。

Provider 默认调用 `https://captcha.aliyuncs.com/VerifyIntelligentCaptcha`，也可通过 `ALIYUN_CAPTCHA_API_URL` 指定 HTTPS 端点。请求体使用阿里云字段 `CaptchaVerifyParam`、`SceneId`、`AppId`、`AppKey` 和可选 `RemoteIp`。前端仅提交一次性 `captchaVerifyParam` 票据，服务端固定使用配置的 SceneId，不信任前端场景标签。

仍需用户从控制台复制：真实 `SceneId`、方案 `AppId`、方案 `AppKey`，以及若控制台要求自定义网关时的 HTTPS 校验端点。不要复制或提交截图中出现的任何密钥。
