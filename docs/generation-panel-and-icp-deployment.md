# AI 生成面板与中国大陆/香港部署决策

> 状态：最终补充规格。产品功能范围在本文后锁定；后续只做实现、修复、性能和安全，不再新增社交或 Agent 模块。

## 1. 功能结论

公开知识平台已经覆盖真实用户、项目、文件、来源、版本、贡献、评论、楼中楼、图片/GIF 附件、关注、收藏、点赞、作者主页、活动、通知、全站搜索、高级筛选和项目内 AI 助手。

本次确定的 AI 生成面板不是新的聊天入口，而是 AI 助手的“可审查产物区”。完成它以后不再新增产品功能大类。

## 2. 生成面板

### 2.1 工作区结构

```text
左：文件树
中：当前文件/报告/PDF/表格
右：AI 助手
    ├── 对话
    ├── 生成结果
    ├── 引用
    └── Diff
```

桌面端使用 shadcn `ResizablePanel + Tabs`；右侧宽度可拖动但设置最小/最大值，避免正文被挤压。移动端使用 Sheet 或全屏结果页。

### 2.2 生成入口

- 选中文字后点击“改写、解释、补来源、总结”；
- 在 AI 输入框中拖入本地文件或使用 `@` 引用已有文件；
- 在文件树上对文件或文件夹选择“生成摘要/对比/目录”；
- 在首页 AI 搜索结果中选择“生成研究简报”；
- 在评论或讨论中选择“生成回复草稿”。

常用模板：

```text
报告摘要
章节目录
竞品对比
证据缺口
风险清单
时间线
结构化表格
引用审查
评论回复
```

### 2.3 生成前上下文预览

生成前必须显示 Context Capsule：

```text
当前项目 / 分支 / 文件
选中的文字或表格行
已引用文件和来源
文件版本与更新时间
权限范围
预计 Token
被排除的文件
```

用户可以移除任意引用或缩小 Scope。AI 不接收没有通过权限过滤的项目、草稿、私人会话或 OSS 原件。

### 2.4 生成结果状态

```text
idle
  -> preparing
  -> retrieving
  -> generating
  -> validating
  -> ready
  -> needs_review
  -> failed / cancelled
```

每个状态都有页面内状态、Toast 和可执行下一步：

| 状态 | 页面显示 | 可执行动作 |
| --- | --- | --- |
| preparing | 准备上下文 | 取消 |
| retrieving | 检索文件和来源 | 取消、查看 Scope |
| generating | 生成中、可停止 | 停止 |
| validating | 校验引用、事实和格式 | 查看校验项 |
| ready | 结果可预览 | 加入草稿、Diff、复制、导出 |
| needs_review | 有冲突、缺来源或过期证据 | 查看证据、人工修正 |
| failed | 失败原因和错误码 | 重试、缩小范围、换模型 |
| cancelled | 已取消，不产生正式内容 | 重新生成 |

### 2.5 生成结果操作

```text
加入当前草稿
新建文档
插入选中位置
查看 Diff
只重生成当前段
查看引用
复制
导出 Markdown/JSON/PDF
重新生成
丢弃
```

“加入当前草稿”只创建 Patch，不直接修改公开版本。用户确认后写入个人分支，再经过 Commit、Diff、Merge Request 和维护者审核。

### 2.6 生成物持久化

```text
ai_generation_job
  id, owner_user_id, project_id, branch_id, status,
  template, input_scope, model, model_version, token_usage,
  error_code, created_at, completed_at
ai_artifact
  id, generation_job_id, artifact_type, content, content_hash,
  validation_state, accepted_at, discarded_at
ai_artifact_source
  artifact_id, source_type, source_id, revision_id, quote, position
```

原始输入、上下文快照、生成结果、引用和最终 Patch 分开保存。删除生成结果不删除原始文件、公开版本或审计事件。

## 3. ICP 备案与香港服务器

### 3.1 当前现象

香港源站 HTTP 可达，但当前 `research.webyrc.com` 经 ESA 代理时返回 `Non-compliance ICP Filing`；ESA 回源 HTTPS 在源站证书签发前返回 `525`。这不是应用代码错误，也不是只允许某一台电脑的 IP。

如果电脑能打开而手机不能，常见原因是电脑已经缓存 HTTPS/HSTS，手机首次访问先走 HTTP；若手机输入 `localhost`，则访问的是手机自身，不是电脑或 ECS。

### 3.2 ICP 备案耗时

时间取决于主体、域名、资料和省份，不能保证固定天数。通常可以按以下范围估算：

| 阶段 | 常见耗时 |
| --- | --- |
| 阿里云资料预审 | 1-3 个工作日 |
| 管局审核 | 通常约 5-20 个工作日，法定审核上限以当期规则为准 |
| 补材料、拍照/核验、退回修改 | 额外 1-4 周 |
| 总体保守估计 | 2-6 周；资料反复退回时可能更久 |

备案要使用真实主体、实名域名、主体证件和符合要求的备案服务码/云资源。`research.webyrc.com` 是子域名，通常在 `webyrc.com` 的主体备案下申报，不会独立获得一套备案号。备案通过后仍要完成公安联网备案等后续事项（以所在地要求为准）。

如果目标是尽快让中国大陆手机访问，建议不要把产品上线时间绑定在 ICP 审核上，优先切换香港入口；以后需要长期大陆合规运营，再并行办理 ICP。

### 3.3 方案对比

| 方案 | 上线速度 | 大陆访问 | 适合场景 |
| --- | --- | --- | --- |
| 保留上海 ECS + ICP | 2-6 周或更久 | 稳定 | 长期面向大陆公开运营 |
| 香港 ECS | 通常数小时 | 通常可直接访问，无大陆 ICP 接入拦截 | 个人使用、快速上线、跨境访问 |
| VPN/Tailscale | 数十分钟 | 仅授权设备/网络可访问 | 私人内测，不公开 |

## 4. 香港 ECS 设置

### 4.1 推荐规格

个人使用的 V1 建议：

```text
地域：香港
系统：Ubuntu 22.04/24.04 LTS
CPU：2 vCPU
内存：4 GiB
系统盘：40-60 GiB SSD
公网：固定 IPv4
Swap：1-2 GiB
```

如果要保存大量 PDF、图片和 GIF，附件必须继续放 OSS，服务器磁盘只保存容器、日志和临时文件。

### 4.2 安全组

```text
80/tcp   0.0.0.0/0      Caddy HTTP/HTTPS 跳转和证书验证
443/tcp  0.0.0.0/0      公网 HTTPS
22/tcp   仅自己的固定 IP  SSH 管理
3000     不开放
5432     不开放
3389     不开放
```

如果是个人内测，可以只开放 443，再通过 VPN 管理；不要把数据库或 Next.js 端口直接暴露公网。

### 4.3 DNS

切换前把 DNS TTL 调低到 300 秒左右，然后修改：

```text
research.webyrc.com  A  <香港 ECS IPv4>
```

没有配置 IPv6 时不要添加 AAAA 记录。确认公共 DNS 的 A 记录已更新后，再启动 Caddy；Caddy 会为 `research.webyrc.com` 自动申请 Let's Encrypt 证书。不要把证书私钥提交 Git。

### 4.4 应用环境变量

在香港服务器 `/srv/research-workbench/.env` 设置真实值；只提交 `.env.example`，不提交 `.env`：

```dotenv
DOMAIN=research.webyrc.com
NEXTAUTH_URL=https://research.webyrc.com
NEXTAUTH_SECRET=<随机生成>
POSTGRES_DB=research_workbench
POSTGRES_USER=research
POSTGRES_PASSWORD=<随机长密码>
DATABASE_URL=postgres://research:<同一密码>@postgres:5432/research_workbench
CADDY_BASIC_AUTH_HASH=<bcrypt 哈希>

MODEL_API_BASE_URL=<OpenAI-compatible endpoint>
MODEL_API_KEY=<轮换后的 key>
MODEL_NAME=gpt-5.6-terra

OSS_AUTH_MODE=ecs_ram_role
OSS_RAM_ROLE_NAME=research-oss
OSS_BUCKET=reaserch
OSS_REGION=cn-shanghai
OSS_ENDPOINT=https://oss-cn-shanghai.aliyuncs.com
OSS_FORCE_HTTPS=true
```

香港 ECS 不能自动继承原上海 ECS 的实例 RAM 角色。若应用继续使用 ECS RAM Role，需要在香港 ECS 绑定同名角色并验证 IMDSv2；不要为了省事把永久 AccessKey 写入 `.env`。如果跨地域 RAM 角色不可用，应使用受控的临时 STS 凭据或重新绑定实例角色。

### 4.5 OSS CORS

Bucket 仍保持私有。浏览器直传前配置实际站点 Origin：

```text
AllowedOrigin: https://research.webyrc.com
AllowedMethod: PUT, GET, HEAD
AllowedHeader: Content-Type, x-oss-meta-sha256
ExposeHeader: ETag
```

不要使用 `*` 作为生产 Origin。CORS 只允许浏览器完成跨域请求，不改变 Bucket ACL；对象读取继续使用短期签名 URL。

## 5. 迁移步骤

```text
1. 香港 ECS 安装 Docker Engine 和 Compose Plugin
2. 配置安全组、固定 IP、Swap 和 DNS
3. 创建 .env，验证模型 Provider 和 OSS RAM Role
4. 从旧服务器 pg_dump PostgreSQL
5. 在香港服务器启动 PostgreSQL，恢复数据库并运行迁移
6. 复制/迁移 uploads_data，或确认原件均在 OSS
7. 构建并启动 app、migrate、postgres、caddy
8. 验证 /api/healthz、公开项目、匿名 AI、登录、上传和私有权限
9. 修改 DNS A 记录到香港 IPv4
10. 等证书签发后做手机 4G、手机 Wi-Fi 和电脑公网验收
11. 保留旧上海 ECS 和数据库备份至少 7 天，再决定是否释放
```

切换期间不要同时让两个实例写同一份数据库。迁移前先停写或进入维护模式，完成备份校验后再切 DNS。DNS 切换不是数据库同步机制。

## 6. 上线验收

- [ ] 手机 4G 访问 `https://research.webyrc.com` 返回应用，而不是 ICP 拦截页
- [ ] 手机 Wi-Fi 和电脑公网访问结果一致
- [ ] HTTPS 证书域名、有效期和自动续期正常
- [ ] `/api/healthz` 返回应用健康和 PostgreSQL 持久化状态
- [ ] 匿名只能读取公开项目和有限 AI，不能读取私有项目
- [ ] 登录后创建项目、拖动上传、OSS ETag 校验、解析重试正常
- [ ] 文件、评论图片/GIF、AI 生成物均能从 OSS 受控读取
- [ ] 80/443 对公网，22 仅管理 IP，3000/5432/3389 不可公网访问
- [ ] PostgreSQL 和 OSS 备份可恢复，旧实例保留回滚点

## 7. 最终建议

如果你现在的目标是自己使用并尽快让手机访问，选择香港 ECS 更合适：部署和 DNS 切换通常当天完成，不必等待 ICP 审核。若以后要面向中国大陆长期公开运营，再保留域名并办理 `webyrc.com` 的 ICP 备案，届时可以迁回上海 ECS 或继续使用香港计算节点并按业务合规要求评估。
