# 内测期间的认证关闭模式

当前公开站点允许匿名阅读公开项目和全站搜索；AI 助手、登录、注册、上传、创建项目、编辑和提交贡献暂不对外开放。点击这些入口只显示“登录功能暂未开放，仅对内测用户开放”，不会跳转认证表单，也不会调用邮箱、短信、图形验证或 OAuth。

## 开关

- 服务端运行时：`PUBLIC_AUTH_ENABLED=false`
- 浏览器构建时：`NEXT_PUBLIC_PUBLIC_AUTH_ENABLED=false`

生产环境未配置服务端开关时也默认关闭，避免误开放；开发/测试环境未配置时默认开启，便于运行认证契约测试。重新开放内测时，两项都设为 `true`，重新构建客户端并滚动部署。

## 边界

`/login` 和 `/upload` 在服务端直接返回关闭提示页；注册、验证码申请、验证码校验和密码找回 API 在关闭时返回 `403 AUTH_CLOSED`。Auth.js Provider 配置和真实 Provider 代码仍保留，开启开关后无需重写认证主链路。

相关实现：`lib/auth/public-access.ts`、`components/platform/auth/auth-closed.tsx`、`components/platform/login-gate-dialog.tsx`。
