/** @type {import('next').NextConfig} */
const nextConfig = {
  // Windows local builds may not have permission to create pnpm symlinks for standalone output.
  // Docker/CI explicitly sets NEXT_STANDALONE=1 and builds on Linux, where the deploy artifact is created.
  output: process.env.NEXT_STANDALONE === "1" ? "standalone" : undefined,
  experimental: {
    serverComponentsExternalPackages: ["postgres"],
  },
};

export default nextConfig;
