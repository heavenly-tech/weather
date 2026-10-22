import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  agentRules: false,
  serverExternalPackages: ["cesium"],
  // Keep dead weight out of the standalone server bundle.
  // The app never uses next/image, so the image optimizer and its native
  // libvips binaries (~27 MB) are never loaded at runtime. The capsize font
  // metrics are only read by the next/font loader at build time.
  outputFileTracingExcludes: {
    "*": [
      "./node_modules/sharp/**",
      "./node_modules/@img/**",
      "./node_modules/next/dist/server/capsize-font-metrics.json",
    ],
  },
};

export default nextConfig;
