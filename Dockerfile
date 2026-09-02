# 生产镜像只运行 Next.js standalone 输出；依赖安装和构建应优先在本地或 CI 完成。
FROM node:20-bookworm-slim AS dependencies

WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1

COPY package.json pnpm-lock.yaml ./
# 固定与当前 lockfile 一致的 pnpm，避免 Corepack 默认版本漂移导致 CI/本地构建不一致。
RUN corepack enable && corepack prepare pnpm@10.6.2 --activate && pnpm install --frozen-lockfile

# 构建阶段保留开发依赖，以便 Next.js 完成类型检查和生产构建。
FROM node:20-bookworm-slim AS builder

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_STANDALONE=1

# 图形验证 AppId 仅是前端公开标识；通过构建参数注入客户端，AppKey 仍只在运行时环境中。
ARG NEXT_PUBLIC_ALIYUN_CAPTCHA_APP_ID
ENV NEXT_PUBLIC_ALIYUN_CAPTCHA_APP_ID=${NEXT_PUBLIC_ALIYUN_CAPTCHA_APP_ID}

COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN corepack enable && corepack prepare pnpm@10.6.2 --activate && pnpm build

# 运行阶段不带源码、构建缓存和包管理器，降低 2 GiB 服务器的磁盘与内存压力。
FROM node:20-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

# 非 root 用户只能写入挂载的上传目录，避免应用进程修改容器文件系统。
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs \
    && mkdir -p /app/data/uploads \
    && chown -R nextjs:nodejs /app

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/scripts/run-migrations.mjs ./scripts/run-migrations.mjs
# 社区场景数据必须在迁移后由运维显式运行；将脚本放入 runner，避免生产容器找不到 seed 入口。
COPY --from=builder --chown=nextjs:nodejs /app/scripts/seed-community.mjs ./scripts/seed-community.mjs
COPY --from=builder --chown=nextjs:nodejs /app/scripts/enrich-enterprise-reports.mjs ./scripts/enrich-enterprise-reports.mjs
COPY --from=builder --chown=nextjs:nodejs /app/scripts/refresh-market-data.mjs ./scripts/refresh-market-data.mjs
COPY --from=builder --chown=nextjs:nodejs /app/scripts/refresh-analyst-theses.mjs ./scripts/refresh-analyst-theses.mjs
COPY --from=builder --chown=nextjs:nodejs /app/db/migrations ./db/migrations

USER nextjs
EXPOSE 3000

# 生产编排由独立 migrate 服务先执行迁移；默认命令仍只启动 Next.js。
CMD ["node", "server.js"]

# 可选解析 Worker 镜像。默认 Compose 不构建/启动该 target，避免 2C2G 实例常驻额外进程；
# 该镜像保留 TypeScript 运行时与源码，仅用于私网 one-shot/定时任务，不暴露 HTTP 端口。
FROM dependencies AS ingestion

WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

COPY . .

RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs worker \
    && chown -R worker:nodejs /app

USER worker

CMD ["node_modules/.bin/tsx", "scripts/run-asset-ingestion-worker.ts"]

# 保证不指定 target 的 `docker build .` 仍得到 Next.js runner，而不是可选 Worker。
# Compose 的 app/migrate 也显式指定 runner；ingestion 只能通过 profile 使用。
FROM runner AS default
