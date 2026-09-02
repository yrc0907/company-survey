# 2026-09-02 验证记录

本文只记录本次实际运行结果，未通过项不会标记为完成。

## 已通过

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`（包含认证 Provider、验证码状态机、公开数据契约）
- 四家首批及八家第二批官网 HEAD 检查均返回 `200`
- 香港 ECS `021_identity_verification.sql` 已应用
- 香港 ECS `022_public_company_seed.sql` 已应用，数据库现有四个企业公开项目
- 香港 ECS 当前 `app/postgres/caddy` healthy，公网首页和 `/api/healthz` 返回 `200`

## 已发现并处理

### `DEPLOY-SEED-001`：修改已执行迁移导致校验和风险

- 发现：扩充企业清单时修改了已在生产执行的 `022_public_company_seed.sql`。
- 根因：迁移系统按文件 SHA-256 拒绝历史文件变化。
- 处理：恢复 `022` 原文，新增独立 `024_public_company_seed_additional.sql`，保存第二批八家公司。
- 状态：本地契约通过；`024` 尚未部署到香港数据库，需发布后复核。

### `E2E-HOME-002`：主题按钮在异步列表替换期间脱离 DOM

- 发现：旧脚本写死 `# 十五五规划 12`，并在 SSR Seed 与 PostgreSQL 列表切换期间点击。
- 根因：按钮文本中的统计数字来自真实数据库，且 React 异步替换会使旧 locator 失效。
- 处理：测试改为语义定位主题按钮，并在列表状态稳定后再操作；工作台智能体还会补充页面级稳定状态和文件切换场景。
- 状态：公网完整 E2E 尚未重新通过，不能标记完成。

## 当前待验收

- 024 第二批八家公司在香港数据库落库、来源 metadata 和 `unique_readers=0`
- 认证 023 迁移随新镜像发布，服务端环境仍未配置真实 SMTP/SMS/CAPTCHA
- 详情页每个文件点击后正文是否切换、文件夹展开/搜索/拖放/移动端是否全部通过
- ESA 公网完整 Playwright 运行稳定性
