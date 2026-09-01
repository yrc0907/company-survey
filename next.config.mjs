/** @type {import('next').NextConfig} */
const nextConfig = {
  // Windows local builds may not have permission to create pnpm symlinks for standalone output.
  // Docker/CI explicitly sets NEXT_STANDALONE=1 and builds on Linux, where the deploy artifact is created.
  output: process.env.NEXT_STANDALONE === "1" ? "standalone" : undefined,
  experimental: {
    // 原生密码哈希与服务端 SDK 由 Node 在运行时加载，禁止进入浏览器或 Webpack Bundle。
    serverComponentsExternalPackages: ["postgres", "@node-rs/argon2", "ali-oss", "@alicloud/credentials"],
  },
};

export default nextConfig;
