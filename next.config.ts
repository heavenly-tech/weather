import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  agentRules: false,
  transpilePackages: ["cesium"],
  serverExternalPackages: ["cesium"],
};

export default nextConfig;
