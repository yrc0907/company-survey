# 个人服务器部署

> 目标实例：Ubuntu 22.04、2 vCPU、2 GiB 内存、20 GiB SSD、100 Mbps 峰值带宽。本文只覆盖个人调研工作台，不部署本地大模型、OCR、Neo4j、Redis、RabbitMQ、Temporal、Kubernetes 或多 Agent。

## 1. 部署结构与资源边界

```text
Internet
  -> Caddy: HTTPS、基础认证、健康检查
  -> Next.js: Web / API
  -> PostgreSQL: 报告、来源、引用、关系与版本
  -> Docker 卷: PostgreSQL 与上传附件
  -> 外部模型 / 搜索 Provider
```

容器内存上限约为 Caddy `128 MiB`、应用 `640 MiB`、PostgreSQL `512 MiB`。这是给 2 GiB 实例留出的保守运行预算，不适合在服务器构建 Next 镜像、批量解析大文件或运行本地模型。

`BGE-M3` 如需启用，只在有 GPU 的本地开发机离线生成 embedding；服务器只存储向量、执行过滤和查询。详细检索架构见 [retrieval-architecture.md](retrieval-architecture.md)。

## 1.1 实际部署记录（2026-09-02）

本次香港迁移使用分支提交 `9b2b9c8`，服务器目录为 `/srv/research-workbench`。以下为实际命令与运行结果，不包含任何密码、Key 或 Basic Auth 凭据：

| 项目 | 实际结果 |
| --- | --- |
| 运行环境 | Ubuntu Linux、Docker `29.7.2`、Docker Compose `v5.5.0` |
| 资源 | 约 `1.6 GiB` 内存、已启用 `1 GiB` swap；应用构建后根盘约 `31 GiB` 可用 |
| 构建 | 香港 ECS 上 `docker compose build app migrate` 成功完成 Next.js 生产构建 |
| 容器 | `postgres`、`app`、`caddy` 三个容器均为 `healthy` |
| 数据库 | 容器内 `/api/healthz` 返回 `200` 和 `persistence: "postgres"`；旧服务器备份已恢复，`project-huice` 存在，迁移表包含 `014_author_follows.sql` |
| 持久化 | PostgreSQL 和上传目录均使用 Compose named volume，不向公网发布 `5432` |
| 模型链路 | 服务器受限 `.env` 的模型、Embedding、Rerank 三个 Provider 已做连通性验证；Key 不在 Git、文档或日志中 |
| Caddy | 配置校验通过，服务器本机已监听 `80` 与 `443`；应用 `3000` 仅在 Compose 内部暴露 |

### 公网验收状态

香港源站的 HTTP 直连（`--resolve research.webyrc.com:80:47.57.138.55`）返回 Caddy 的 `308`，容器和安全组端口正常。当前 ESA 代理仍处于启用状态，公网请求返回阿里云 `403 Non-compliance ICP Filing`；ESA 回源 HTTPS 在源站证书签发前返回 `525`，因此下列 HTTPS 公网验收尚未成立。必须先在 ESA 暂时关闭代理（DNS-only）或把回源协议临时改为 HTTP，让 Caddy 完成 ACME 证书申请；证书成功后再恢复 ESA HTTPS 回源，并重新执行验收。该切换属于高影响人工操作，不能由仓库脚本擅自完成。

当前已验证结果：

```text
HTTP /healthz              -> 308 redirect to HTTPS
HTTP source /healthz       -> 308, Caddy source reachable
ESA HTTP /healthz          -> 403, ICP compliance block
ESA HTTPS /healthz         -> 525, origin certificate not ready
App / PostgreSQL / Caddy   -> healthy inside ECS
```

公开平台补充验收（通过 SSH 隧道直连源站容器/API 已完成；ESA 公网入口待切换后复跑）：

```text
GET /api/platform/projects（源站隧道）               -> 200，`project-huice` 可匿名读取
GET /api/platform/projects/project-huice（源站隧道）  -> 200，文件树可读取
POST /api/research/assistant（源站隧道）              -> 受限上下文链路可调用
GET /api/research/workbench（源站隧道）               -> Basic Auth 边界按配置返回
POST /api/platform/uploads（未登录，源站隧道）        -> 401，上传不允许匿名
POST /api/platform/projects/project-huice/view（匿名） -> 200，签发访客 Cookie，重复阅读幂等
GET /api/platform/projects/project-huice/star（匿名）  -> 200，返回公开 Star 聚合
pgvector 能力探测                                    -> available=false，保留 FTS/确定性降级
GET /api/platform/authors/yu-research（匿名）          -> 200，作者主页只返回公开项目
GET /api/platform/authors/yu-research/follow（匿名）   -> 200，返回公开关注计数
```

完整界面流程通过 SSH 隧道连接实际服务器 App 验收：浏览器写入资料后来源数立即更新，PostgreSQL FTS 与 Dense RRF 均返回真实状态（`lexical=postgres_fts`、`dense=completed`），AI 使用 `gemini-embedding-2-preview -> qwen3-rerank -> gpt-5.6-terra` 生成带来源回答。服务器 API 另行验证了版本从 1 保存到 2，以及旧版本写入被 `409 VERSION_CONFLICT` 拒绝。公网入口因 ESA ICP/源站证书链路尚未切换，不能把上述源站验收写成公网验收。

应用 `3000` 和数据库 `5432` 均未向公网发布。解析 Worker 已通过 `ingestion` profile 实际构建、空队列运行并正常退出，未作为常驻服务启动。当前安全组仍需收尾：将 SSH `22` 从 `0.0.0.0/0` 限制为可信管理来源，并删除 Linux 实例不需要的 RDP `3389` 规则。

## 2. 上线前准备

1. 域名添加 A 记录，指向服务器公网 IP；Caddy 需要可验证的公网 DNS 才能签发 HTTPS 证书。
2. 阿里云安全组只开放：`80/tcp`、`443/tcp`；`22/tcp` 应仅放行自己的固定 IP。不要开放 `3000` 或 `5432`。
3. 在服务器创建部署目录，例如 `/srv/research-workbench`，并将仓库代码和本地构建镜像/CI 镜像放入该目录。
4. 安装 Docker Engine 与 Docker Compose Plugin。确认 `docker compose version` 可用后再继续。
5. 在服务器启用 1 GiB swap。Swap 是内存瞬时峰值的保护，不是运行本地模型的理由：

```bash
sudo fallocate -l 1G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h
```

## 3. 配置服务器 `.env`

不要把 `.env`、密码、模型 Key、搜索 Key、数据库备份或上传资料提交到 Git，也不要发进聊天。所有之前在聊天中暴露过的 Key 都应先在服务商后台轮换。

```bash
cd /srv/research-workbench
cp .env.example .env
chmod 600 .env
```

在服务器 `.env` 中填写或补充以下项，值必须自行生成：

```dotenv
DOMAIN=research.example.com
APP_USERNAME=researcher

# 使用随机强密码，并确保 DATABASE_URL 中的密码与此处相同。
POSTGRES_DB=research_workbench
POSTGRES_USER=research
POSTGRES_PASSWORD=<generate-a-long-random-password>
DATABASE_URL=postgres://research:<same-random-password>@postgres:5432/research_workbench

# 用下方命令生成。单引号会保留 bcrypt 哈希中的 $，避免 Compose 插值破坏哈希。
CADDY_BASIC_AUTH_HASH='<paste-caddy-bcrypt-hash-here>'

# 按需启用模型与搜索 Provider；未配置时页面应明确显示未配置状态。
MODEL_API_KEY=<rotated-model-key>
DEEPSEEK_API_KEY=<rotated-optional-key>
```

生成 Caddy 的 bcrypt 哈希，**只复制命令输出到服务器 `.env`**：

```bash
docker run --rm caddy:2.8.4-alpine caddy hash-password --plaintext 'choose-a-long-unique-password'
```

公开平台上线后，Caddy 只对旧版 `/api/research/*` 个人接口保留 Basic Auth；首页、公开项目、Auth.js 和平台 API 由应用层 Session/RBAC 判权。应用与数据库仅在 Compose 内部网络可见。公开 AI 目前是单实例 IP 限流，规模增大后必须迁移到 Redis/网关限流。

## 4. 构建与启动

### 4.1 优先本地或 CI 构建

2 GiB 服务器上执行 `docker compose build` 容易在 Next.js 构建阶段耗尽内存。优先在本地或 CI 构建：

```bash
# 在已验证的本地工作区构建
docker build -t research-workbench:local .
docker save research-workbench:local | gzip > research-workbench-image.tar.gz

# 将压缩镜像和仓库文件安全复制到服务器后，在服务器加载
gzip -dc research-workbench-image.tar.gz | docker load
```

也可以由 CI 推送私有镜像仓库，并在服务器 `.env` 设置：

```dotenv
APP_IMAGE=registry.example.com/research-workbench:<immutable-tag>
```

加载本地镜像或拉取 CI 镜像后启动：

```bash
cd /srv/research-workbench
docker compose pull caddy postgres
docker compose up -d
docker compose ps
```

首次启动由 Caddy 申请 HTTPS 证书。若 DNS 或安全组未准备好，Caddy 不能签发证书，必须先修正网络配置，不能改为长期裸露的 `IP:3000`。

### 4.2 部署预检和健康检查

在 Windows 本地或装有 PowerShell 的环境执行：

```powershell
./scripts/deploy-check.ps1 -EnvFile .env
```

在服务器通过 HTTPS 检查：

```bash
curl -fsS https://research.example.com/healthz
curl -u 'researcher:<basic-auth-password>' -I https://research.example.com/
docker compose ps
docker compose logs --tail=100 app postgres caddy
```

`/healthz` 没有业务数据；旧版 `/api/research/*` 由 Caddy Basic Auth 保护，平台公开页面和平台 API 由 Auth.js/RBAC 决定访问。应用与数据库端口不对公网发布，容器内的 `/api/healthz` 只供 Compose 健康检查使用。

## 5. 日常运维

### 5.1 磁盘、内存、流量

20 GiB 磁盘是首要限制。每周至少检查：

```bash
df -h /
docker system df
free -h
docker compose ps
```

- 为系统、容器、数据库和附件保留至少 `5 GiB` 可用磁盘；空间不足时先备份，再清理无用镜像与旧日志，**绝不执行会删除 named volume 的清理命令**。
- 限制单文件上传大小，避免长期保存无关网页资源与重复附件；资料增多后优先扩容磁盘或单独挂载数据盘。
- 在阿里云设置余额、月流量和带宽异常告警。`100 Mbps` 是峰值，不代表超额流量免费。
- 观察 swap 持续使用、容器重启和 PostgreSQL 健康失败；持续 swap 表示应扩容到至少 2 vCPU / 4 GiB / 50 GiB，而不是增加本地模型。

### 5.2 更新

```bash
cd /srv/research-workbench
git pull --ff-only
docker compose pull caddy postgres
docker compose up -d
docker compose ps
```

应用更新使用经过本地/CI 验证的新镜像标签；不要在低内存服务器临时修改代码或直接构建。

### 5.3 可重复的部署自动化

仓库提供了只依赖 Docker Compose 的服务器脚本。脚本默认不会修改云控制台、删除
Docker 卷或清理旧备份；所有脚本都不读取或打印 Key 的明文。先在香港 ECS 上确认
脚本来自已经验证的提交，再执行：

```bash
cd /srv/research-workbench
chmod 700 scripts/backup.sh scripts/health-check.sh scripts/release.sh

# 只读容器/配置预检（Windows 可运行 scripts/deploy-check.ps1）。
bash scripts/health-check.sh --env-file .env --skip-external

# 发布后检查真实域名和证书；不会把 Basic Auth 密码放在命令行。
bash scripts/health-check.sh --env-file .env --url https://research.webyrc.com
```

`scripts/backup.sh` 会验证 PostgreSQL 健康状态和 `research-workbench_uploads_data`
卷存在，然后在 `data/backups/<UTC 时间>/` 写入 `postgres.dump`、`uploads.tar.gz` 和
`manifest.txt`。清单包含 Git 提交和 SHA-256，不包含数据库连接串或模型凭据。数据库与
上传卷必须整体复制到异机；脚本不自动删除旧备份，避免误删唯一恢复点：

```bash
bash scripts/backup.sh --env-file .env --output-dir data/backups
```

标准发布入口会在迁移前备份，迁移失败时停止，不会让新应用跑在旧 schema 上。2 GiB
实例默认使用本地/CI 预构建的不可变 `APP_IMAGE`；只有明确知道内存余量时才传 `--build`：

```bash
bash scripts/release.sh --env-file .env --url https://research.webyrc.com
# 服务器确实需要构建时才使用：
# bash scripts/release.sh --env-file .env --build --url https://research.webyrc.com
```

发布记录写入 `data/releases/<UTC 时间>.txt`，其中只记录提交、旧应用镜像和流程状态。
发布失败时保留旧容器、镜像和备份；回滚必须由人工选择已验证的镜像与对应数据库恢复点，
不能把自动回滚当作数据恢复。跳过备份需要同时显式传入
`--skip-backup --confirm-skip-backup`，不建议在生产使用。

#### 安全组声明式检查

`scripts/aliyun-security-group.ps1` 默认是只读计划模式，使用服务器上的 `aliyun`
CLI/RAM 临时凭据查询安全组，不接收 AccessKey 参数，也不把凭据写入文件。它只计划或
（显式确认后）新增以下最小规则：公网 `tcp/80`、`tcp/443`，以及指定管理网段的
`tcp/22`：

```powershell
# 只读：查看缺失规则，不会修改阿里云资源
pwsh ./scripts/aliyun-security-group.ps1 `
  -SecurityGroupId sg-hk-example `
  -ManagementCidr 203.0.113.8/32

# 需要变更时必须显式确认；仍不会删除任何规则
pwsh ./scripts/aliyun-security-group.ps1 `
  -SecurityGroupId sg-hk-example `
  -ManagementCidr 203.0.113.8/32 `
  -Apply -ConfirmText ALLOW-HK-ECS-SECURITY-GROUP
```

脚本不会自动撤销 `3389`、`3000`、`5432`，也不会猜测你的管理 IP。完成计划后仍需人工
在阿里云变更流程中核对：`22` 仅可信固定来源，`80/443` 公网开放，`3000/5432/3389`
关闭。安全组 ID、管理 CIDR、DNS/ESA NS 切换和备案属于高影响外部操作，必须人工确认。

#### 哪些可以代码化，哪些必须人工

| 操作 | 自动化边界 |
| --- | --- |
| Compose 配置、迁移、启动、健康检查、备份与发布记录 | 脚本可重复执行；失败即停并保留证据 |
| 安全组规则查询和新增 80/443/指定 22 | 默认计划；显式 `-Apply` 才写入，永不自动删除 |
| 删除 3389、收紧 22、修改默认安全组 | 人工审核目标和来源后操作 |
| 域名 A/AAAA、ESA NS、证书申请和 CDN 缓存策略 | 可由 API/IaC 辅助，但切换前必须人工确认 |
| RAM 角色、临时凭据、备案、实名和云账号恢复 | 必须控制台/人工安全确认 |
| 数据库/上传卷恢复 | 必须先核对备份配对、目标卷和恢复窗口，再人工执行 |

## 6. 备份与恢复

至少每天备份 PostgreSQL 和上传卷，并将备份复制到服务器之外。数据库备份与附件必须成对保留。

```bash
cd /srv/research-workbench
mkdir -p data/backups
backup_date=$(date +%F)

docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > "data/backups/postgres-${backup_date}.dump"

docker run --rm \
  -v research-workbench_uploads_data:/data:ro \
  -v "$PWD/data/backups":/backup \
  alpine:3.20 tar -czf "/backup/uploads-${backup_date}.tar.gz" -C /data .
```

恢复会覆盖当前数据。先在隔离环境测试备份，再执行：

```bash
cd /srv/research-workbench
docker compose stop app

cat data/backups/postgres-YYYY-MM-DD.dump | \
  docker compose exec -T postgres pg_restore -U research -d research_workbench --clean --if-exists --no-owner

docker run --rm \
  -v research-workbench_uploads_data:/data \
  -v "$PWD/data/backups":/backup:ro \
  alpine:3.20 sh -c 'rm -rf /data/* && tar -xzf /backup/uploads-YYYY-MM-DD.tar.gz -C /data'

docker compose start app
```

恢复命令中的数据库名、用户和日期必须替换为实际备份对应值；执行前确认目标是本项目的 PostgreSQL 和 `uploads_data` 卷，不要对其他容器或目录执行覆盖操作。

## 7. 故障边界

| 现象 | 优先检查 | 不应采取的做法 |
| --- | --- | --- |
| Caddy 无法签发证书 | DNS A 记录、80/443 安全组、域名是否可公网解析 | 暴露 Next.js `3000` 端口绕过认证 |
| App 不健康 | `docker compose logs app`、`.env`、数据库健康状态 | 在服务器临时安装本地模型或跳过检查 |
| PostgreSQL 重启 | `free -h`、swap、磁盘、容器日志 | 无备份直接删除数据库卷 |
| 磁盘接近满 | `df -h`、附件、镜像和日志 | `docker system prune --volumes` |
| AI 或搜索不可用 | Provider 配置、网络、响应日志 | 伪造搜索结果或让模型无来源回答 |

当资料、文件或并发量超过这台实例的承载范围时，优先扩容磁盘与内存，再评估独立 worker；不要先引入 Redis、RabbitMQ、Kubernetes 或本地模型。

## 8. 开放知识平台 OSS 预配置

未来上传功能使用私有 Bucket `reaserch`，地域 `cn-shanghai`，公网 HTTPS Endpoint 为 `https://oss-cn-shanghai.aliyuncs.com`。Bucket 已开启阻止公共访问，ACL 保持私有；不得为了公开报告或头像改为公共读写。

ECS 已绑定 `research-oss` RAM 角色。IMDSv2 元数据验证返回角色名和临时凭据 `Code=Success`，凭据自动过期轮换。服务器不需要、也不应保存 `OSS_ACCESS_KEY_ID` 或 `OSS_ACCESS_KEY_SECRET`。

目标环境变量：

```dotenv
OSS_AUTH_MODE=ecs_ram_role
OSS_RAM_ROLE_NAME=research-oss
OSS_BUCKET=reaserch
OSS_REGION=cn-shanghai
OSS_ENDPOINT=https://oss-cn-shanghai.aliyuncs.com
OSS_FORCE_HTTPS=true
```

以上配置用于生产镜像的真实 OSS SDK、预签名 `PutObject/GetObject` 和受控 `DeleteObject`。应用只使用 ECS RAM Role 临时凭据，不保存永久 AccessKey；数据库先做所有者/项目权限过滤，再签发短期 URL。浏览器直传必须同时发送 `x-oss-meta-sha256`，适配器会兼容 `result.meta.sha256` 和原始响应头，缺失时由完成接口流式重算。删除只针对隔离对象，已验证原件不可由取消接口删除。上线前仍需在目标 Bucket CORS 和香港 ECS 环境验证 `PutObject/GetObject/DeleteObject` 权限边界、跨用户拒绝、签名过期、重复上传和跨地域延迟。

### 可选解析 Worker

解析 Worker 不属于默认常驻服务。Dockerfile 提供 `ingestion` target，Compose 通过 `ingestion` profile 按需构建并运行 one-shot 任务：

```bash
ASSET_INGESTION_DRAIN=true ASSET_INGESTION_MAX_JOBS=100 \
  docker compose --profile ingestion run --rm ingestion
```

该镜像使用与仓库一致的 `tsx` 运行时和 `scripts/run-asset-ingestion-worker.ts`，通过 Compose 内网访问 PostgreSQL，并以 ECS RAM Role 读取私有 OSS；无任务时正常退出，不监听端口。默认 `docker compose up -d` 不构建、不启动此服务，不增加应用常驻内存。Worker 会在迁移 `008_asset_ingestion_worker.sql` 成功后才可运行。
