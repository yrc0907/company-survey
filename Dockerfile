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

USER nextjs
EXPOSE 3000

# Next.js standalone 的 server.js 只监听容器内端口，由 Caddy 对外暴露 HTTPS。
CMD ["node", "server.js"]
