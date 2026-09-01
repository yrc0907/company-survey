#!/usr/bin/env bash
# 验证 Compose 服务、应用内部健康端点与可选公网 HTTPS。
# 输入：项目目录、环境文件和公网 URL。输出：不包含机密的健康结果。
# 副作用：只读 Docker 状态和 HTTP 状态，不重启服务、不修改数据。

set -Eeuo pipefail

PROJECT_DIR="$(pwd)"
ENV_FILE=".env"
PUBLIC_URL=""
SKIP_EXTERNAL=false

usage() {
  cat <<'USAGE'
用法：scripts/health-check.sh [选项]

选项：
  --project-dir DIR   Compose 项目目录（默认当前目录）
  --env-file FILE     环境文件路径（默认 .env）
  --url URL           公网基址，例如 https://research.webyrc.com
  --skip-external     只检查容器内服务
  -h, --help          显示帮助
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-dir) PROJECT_DIR="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --url) PUBLIC_URL="$2"; shift 2 ;;
    --skip-external) SKIP_EXTERNAL=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数：$1" >&2; usage >&2; exit 2 ;;
  esac
done

cd "$PROJECT_DIR"
[[ -f "$ENV_FILE" ]] || { echo "缺少环境文件：$ENV_FILE" >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "未找到 Docker CLI。" >&2; exit 1; }
compose=(docker compose --env-file "$ENV_FILE")
"${compose[@]}" config --quiet

check_health() {
  # 输入 Compose 服务名，输出运行/健康状态；只读 Docker 元数据并在失败时返回非零。
  local service="$1"
  local container status
  container="$("${compose[@]}" ps -q "$service")"
  [[ -n "$container" ]] || { echo "FAIL $service: 容器未创建" >&2; return 1; }
  status="$(docker inspect --format '{{.State.Status}}' "$container")"
  [[ "$status" == "running" ]] || { echo "FAIL $service: 状态=$status" >&2; return 1; }
  if docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container" | grep -q .; then
    local health
    health="$(docker inspect --format '{{.State.Health.Status}}' "$container")"
    [[ "$health" == "healthy" ]] || { echo "FAIL $service: 健康=$health" >&2; return 1; }
  fi
  echo "PASS $service: running/healthy"
}

check_health postgres
check_health app
check_health caddy

# 应用端点在 Compose 网络内检查，避免把 3000 暴露到公网。
"${compose[@]}" exec -T app node -e \
  "fetch('http://127.0.0.1:3000/api/healthz').then((r) => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1))"
echo "PASS app internal /api/healthz"

"${compose[@]}" exec -T postgres sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null
echo "PASS postgres pg_isready"

# Compose 只允许 app 通过 expose 提供 3000，PostgreSQL 不应发布 5432。
if [[ -n "$("${compose[@]}" port app 3000 2>/dev/null || true)" ]]; then
  echo "FAIL app: 3000 被发布到宿主机" >&2
  exit 1
fi
if [[ -n "$("${compose[@]}" port postgres 5432 2>/dev/null || true)" ]]; then
  echo "FAIL postgres: 5432 被发布到宿主机" >&2
  exit 1
fi
echo "PASS private ports: app 3000/postgres 5432 未发布"

if [[ "$SKIP_EXTERNAL" == "true" ]]; then
  echo "SKIP external HTTPS check"
  exit 0
fi
if [[ -z "$PUBLIC_URL" ]]; then
  echo "WARN 未提供 --url，跳过公网 HTTPS 检查" >&2
  exit 0
fi
if [[ "$PUBLIC_URL" != https://* ]]; then
  echo "公网检查必须使用 https:// URL；本地测试请显式使用 --skip-external。" >&2
  exit 1
fi
PUBLIC_URL="${PUBLIC_URL%/}"
curl --fail --silent --show-error --max-time 15 \
  --proto '=https' --proto-redir '=https' \
  "$PUBLIC_URL/healthz" >/dev/null
echo "PASS external HTTPS $PUBLIC_URL/healthz"
