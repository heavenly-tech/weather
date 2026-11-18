import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

const root = path.dirname(fileURLToPath(import.meta.url));
const cesium = path.resolve(root, "node_modules/cesium/Build/Cesium");

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    viteStaticCopy({
      targets: [
        { src: path.join(cesium, "Workers"), dest: "cesium" },
        { src: path.join(cesium, "ThirdParty"), dest: "cesium" },
        { src: path.join(cesium, "Assets"), dest: "cesium" },
        { src: path.join(cesium, "Widgets"), dest: "cesium" },
      ],
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
      "next/link": path.resolve(root, "src/client/next-link.tsx"),
      "next/navigation": path.resolve(root, "src/client/next-navigation.ts"),
      "next/dynamic": path.resolve(root, "src/client/next-dynamic.tsx"),
    },
  },
  define: {
    "process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN": JSON.stringify(process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN ?? ""),
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "production"),
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
