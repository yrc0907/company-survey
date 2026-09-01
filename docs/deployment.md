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

## 1.1 实际部署记录（2026-09-01）

本次部署使用提交 `20229c7`，服务器目录为 `/srv/research-workbench`。以下为实际命令与运行结果，不包含任何密码、Key 或 Basic Auth 凭据：

| 项目 | 实际结果 |
| --- | --- |
| 运行环境 | Ubuntu Linux、Docker `29.7.2`、Docker Compose `v5.5.0` |
| 资源 | 约 `1.6 GiB` 内存、已启用 `1 GiB` swap；应用构建后根盘约 `31 GiB` 可用 |
| 构建 | `docker compose build app` 成功完成 Next.js 生产构建 |
| 容器 | `postgres`、`app`、`caddy` 三个容器均为 `healthy` |
| 数据库 | `/api/healthz` 返回 `200` 和 `persistence: "postgres"`；默认研究库、默认报告均已写入，public schema 共有 9 张表 |
| 持久化 | PostgreSQL 和上传目录均使用 Compose named volume，不向公网发布 `5432` |
| 模型链路 | 服务器受限 `.env` 的模型、Embedding、Rerank 三个 Provider 已做连通性验证；Key 不在 Git、文档或日志中 |
| Caddy | 配置校验通过，服务器本机已监听 `80` 与 `443`；应用 `3000` 仅在 Compose 内部暴露 |

### 公网上线结果

`research.webyrc.com` 的 A 记录已解析到部署实例。阿里云安全组放行入站 `80/tcp`、`443/tcp` 后，Caddy 的 TLS-ALPN-01 验证成功并取得受信任证书。首次重试期间曾遇到一次权威 DNS 的 CAA `SERVFAIL`，随后 `dns7.hichina.com`、`dns8.hichina.com` 与 Google DNS 均恢复为 `NOERROR`，重启 Caddy 后证书签发成功。

最终公网验收结果：

```text
HTTP /healthz              -> 308 redirect to HTTPS
HTTPS /healthz             -> 200, certificate verified
HTTPS / without auth       -> 401
HTTPS / with Basic Auth    -> 200
App / PostgreSQL / Caddy   -> healthy
```

完整界面流程通过 SSH 隧道连接实际服务器 App 验收：浏览器写入资料后来源数立即更新，语义搜索返回新资料，AI 使用 `gemini-embedding-2-preview -> qwen3-rerank -> gpt-5.6-terra` 生成带来源回答。服务器 API 另行验证了版本从 1 保存到 2，以及旧版本写入被 `409 VERSION_CONFLICT` 拒绝。

应用 `3000` 和数据库 `5432` 均未向公网发布。当前安全组仍需收尾：将 SSH `22` 从 `0.0.0.0/0` 限制为可信管理来源，并删除 Linux 实例不需要的 RDP `3389` 规则。

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

以上配置目前只是资源准备：当前生产镜像尚无 OSS SDK、预签名上传、CORS、对象路径校验和解析 Worker。实现后必须验证 `PutObject/GetObject/DeleteObject` 权限边界、跨用户拒绝、签名过期、重复上传和跨地域延迟，才能把上传标记为完成。
