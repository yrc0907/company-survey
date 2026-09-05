#!/usr/bin/env bash
# 在香港 ECS 上执行一次可审计发布：预检、成对备份、迁移、启动和健康检查。
# 输入：已验证的仓库/镜像和服务器 .env。副作用：更新本项目 Compose 服务；不修改云控制台。
# 失败时保留旧容器/镜像信息并退出，禁止在未确认的情况下自动回滚或删卷。

set -Eeuo pipefail

PROJECT_DIR="$(pwd)"
ENV_FILE=".env"
PUBLIC_URL=""
BUILD=false
SKIP_BACKUP=false
CONFIRM_SKIP_BACKUP=false

usage() {
  cat <<'USAGE'
用法：scripts/release.sh [选项]

选项：
  --project-dir DIR   Compose 项目目录（默认当前目录）
  --env-file FILE     环境文件路径（默认 .env）
  --url URL           发布后检查的公网 HTTPS 基址
  --build             在服务器构建 app/migrate（2 GiB ECS 不建议）
  --skip-backup       跳过备份（必须同时提供 --confirm-skip-backup）
  --confirm-skip-backup
                      明确确认跳过发布前备份
  -h, --help          显示帮助

发布默认不删除镜像、卷或旧备份；回滚需人工选择已验证的镜像与数据库恢复点。
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-dir) PROJECT_DIR="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --url) PUBLIC_URL="$2"; shift 2 ;;
    --build) BUILD=true; shift ;;
    --skip-backup) SKIP_BACKUP=true; shift ;;
    --confirm-skip-backup) CONFIRM_SKIP_BACKUP=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数：$1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ "$SKIP_BACKUP" == "true" && "$CONFIRM_SKIP_BACKUP" != "true" ]]; then
  echo "跳过备份必须同时提供 --confirm-skip-backup。" >&2
  exit 2
fi

cd "$PROJECT_DIR"
[[ -f "$ENV_FILE" ]] || { echo "缺少环境文件：$ENV_FILE" >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "未找到 Docker CLI。" >&2; exit 1; }
# 仅注入已检出的提交哈希，不读取 .env 内容；公网 healthz 可据此证明流量已切换到本次发布。
export APP_REVISION="$(git rev-parse --verify HEAD 2>/dev/null || echo unknown)"

# .env 可能含数据库和模型密钥；拒绝组/其他用户可读写，避免发布时读取被篡改的配置。
if command -v stat >/dev/null 2>&1; then
  env_mode="$(stat -c '%a' "$ENV_FILE")"
  env_mode_num=$((8#$env_mode))
  if (( (env_mode_num & 63) != 0 )); then
    echo "$ENV_FILE 权限过宽（应为 600 或更严格）：$env_mode" >&2
    exit 1
  fi
fi

compose=(docker compose --env-file "$ENV_FILE")
"${compose[@]}" config --quiet

release_dir="data/releases"
mkdir -p "$release_dir"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
release_record="$release_dir/${stamp}.txt"
{
  printf 'created_at_utc=%s\n' "$stamp"
  printf 'project_dir=%s\n' "$PROJECT_DIR"
  printf 'git_commit=%s\n' "$(git rev-parse HEAD 2>/dev/null || echo unknown)"
  printf 'build_requested=%s\n' "$BUILD"
} > "$release_record"

# 记录当前应用容器的镜像摘要，便于人工选择回滚目标；不输出环境变量。
old_app_container="$("${compose[@]}" ps -q app || true)"
if [[ -n "$old_app_container" ]]; then
  old_image="$(docker inspect --format '{{.Config.Image}}' "$old_app_container" || echo unknown)"
  printf 'previous_app_image=%s\n' "$old_image" >> "$release_record"
fi

if [[ "$SKIP_BACKUP" != "true" ]]; then
  bash "${PROJECT_DIR}/scripts/backup.sh" --project-dir "$PROJECT_DIR" --env-file "$ENV_FILE"
else
  echo "WARN 已明确跳过发布前备份；请在发布记录中注明原因。" >&2
fi

if [[ "$BUILD" == "true" ]]; then
  "${compose[@]}" build app migrate
else
  # 应用镜像应由本地/CI 构建并以不可变标签加载；低内存 ECS 不在服务器构建。
  "${compose[@]}" pull caddy postgres
fi

# 迁移单独运行且失败即停止，避免新代码在旧 schema 上提供服务。
"${compose[@]}" run --rm migrate
"${compose[@]}" up -d --no-build

bash "${PROJECT_DIR}/scripts/health-check.sh" --project-dir "$PROJECT_DIR" --env-file "$ENV_FILE" --skip-external
if [[ -n "$PUBLIC_URL" ]]; then
  bash "${PROJECT_DIR}/scripts/health-check.sh" --project-dir "$PROJECT_DIR" --env-file "$ENV_FILE" --url "$PUBLIC_URL" --expected-revision "$APP_REVISION"
fi

printf 'completed_at_utc=%s\n' "$(date -u +%Y%m%dT%H%M%SZ)" >> "$release_record"
echo "发布完成，记录：$release_record"
