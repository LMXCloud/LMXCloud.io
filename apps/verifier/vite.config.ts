import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const apiAnchors = path.resolve(rootDir, "../api/src/anchors");

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = (env.VITE_API_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: [
        {
          find: "@lmxcloud/api/anchors/receipt",
          replacement: path.join(apiAnchors, "receipt.ts"),
        },
        {
          find: "@lmxcloud/api/anchors/merkle",
          replacement: path.join(apiAnchors, "merkle.ts"),
        },
        {
          find: "@lmxcloud/api/anchors/lookup",
          replacement: path.join(apiAnchors, "lookup.ts"),
        },
      ],
    },
    optimizeDeps: {
      exclude: ["@lmxcloud/api"],
    },
    server: {
      port: 5176,
      host: "127.0.0.1",
      fs: {
        allow: [path.resolve(rootDir, "../..")],
      },
      proxy: {
        "/v1": { target: apiTarget, changeOrigin: true },
      },
    },
  };
});
