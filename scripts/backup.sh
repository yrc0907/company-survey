#!/usr/bin/env bash
# 生成 PostgreSQL 与私有上传卷的成对备份。
# 输入：Compose 项目目录和环境文件。输出：带校验和与清单的不可变备份目录。
# 副作用：只创建备份文件，不停止容器、不删除旧备份、不修改云资源。

set -Eeuo pipefail

PROJECT_DIR="$(pwd)"
ENV_FILE=".env"
OUTPUT_DIR="data/backups"
UPLOADS_VOLUME="research-workbench_uploads_data"

usage() {
  # 输出参数说明；不读取环境文件，因此不会泄露任何配置值。
  cat <<'USAGE'
用法：scripts/backup.sh [选项]

选项：
  --project-dir DIR   Compose 项目目录（默认当前目录）
  --env-file FILE     环境文件路径（默认 .env）
  --output-dir DIR    备份输出目录（默认 data/backups）
  --uploads-volume V  上传卷名称（默认 research-workbench_uploads_data）
  -h, --help          显示帮助

脚本不会删除旧备份；清理和异机复制应由运维人员单独确认。
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-dir) PROJECT_DIR="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --output-dir) OUTPUT_DIR="$2"; shift 2 ;;
    --uploads-volume) UPLOADS_VOLUME="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数：$1" >&2; usage >&2; exit 2 ;;
  esac
done

cd "$PROJECT_DIR"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "缺少环境文件：$ENV_FILE" >&2
  exit 1
fi
if ! command -v docker >/dev/null 2>&1; then
  echo "未找到 Docker CLI。" >&2
  exit 1
fi

compose=(docker compose --env-file "$ENV_FILE")
# 只校验 Compose 配置；不会渲染或打印密钥。
"${compose[@]}" config --quiet

postgres_container="$("${compose[@]}" ps -q postgres)"
if [[ -z "$postgres_container" ]]; then
  echo "PostgreSQL 容器未运行，请先启动 Compose。" >&2
  exit 1
fi
postgres_health="$(docker inspect --format '{{.State.Health.Status}}' "$postgres_container")"
if [[ "$postgres_health" != "healthy" ]]; then
  echo "PostgreSQL 健康状态为 $postgres_health，停止备份。" >&2
  exit 1
fi

if ! docker volume inspect "$UPLOADS_VOLUME" >/dev/null 2>&1; then
  echo "上传卷不存在：$UPLOADS_VOLUME。请用 --uploads-volume 指定实际卷。" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
tmp_dir="$(mktemp -d "$OUTPUT_DIR/.backup-${stamp}.XXXXXX")"
final_dir="$OUTPUT_DIR/${stamp}"
cleanup() {
  # 只清理本次失败留下的临时目录，永不触碰已完成备份或 Docker 卷。
  if [[ -n "${tmp_dir:-}" && -d "$tmp_dir" ]]; then
    rm -rf -- "$tmp_dir"
  fi
}
trap cleanup EXIT

# pg_dump 的连接参数从容器环境读取，避免把密码放入命令行或日志。
"${compose[@]}" exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > "$tmp_dir/postgres.dump"
[[ -s "$tmp_dir/postgres.dump" ]] || { echo "PostgreSQL 备份为空。" >&2; exit 1; }

# 上传原件与数据库必须使用同一时间戳，恢复时才能保持引用一致。
docker run --rm \
  --mount "type=volume,src=$UPLOADS_VOLUME,dst=/data,readonly" \
  alpine:3.20 tar -czf - -C /data . \
  > "$tmp_dir/uploads.tar.gz"
[[ -s "$tmp_dir/uploads.tar.gz" ]] || { echo "上传卷备份为空。" >&2; exit 1; }

commit="unknown"
if command -v git >/dev/null 2>&1; then
  commit="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
fi
{
  printf 'created_at_utc=%s\n' "$stamp"
  printf 'git_commit=%s\n' "$commit"
  printf 'postgres_container=%s\n' "$postgres_container"
  printf 'uploads_volume=%s\n' "$UPLOADS_VOLUME"
  printf 'pairing_required=true\n'
  (cd "$tmp_dir" && sha256sum postgres.dump uploads.tar.gz)
} > "$tmp_dir/manifest.txt"

if [[ -e "$final_dir" ]]; then
  echo "目标备份已存在，拒绝覆盖：$final_dir" >&2
  exit 1
fi
mv -- "$tmp_dir" "$final_dir"
tmp_dir=""
echo "备份完成：$final_dir"
echo "请将整个目录（postgres.dump、uploads.tar.gz、manifest.txt）复制到异机并定期演练恢复。"
