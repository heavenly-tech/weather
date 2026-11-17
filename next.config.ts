import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  agentRules: false,
  serverExternalPackages: ["cesium"],
};

export default nextConfig;
