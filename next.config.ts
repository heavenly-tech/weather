import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  agentRules: false,
  serverExternalPackages: ["cesium"],
  env: {
    NEXT_PUBLIC_CESIUM_ION_TOKEN:
      process.env.CESIUM_ION_TOKEN ?? process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN ?? "",
  },
};

export default nextConfig;
