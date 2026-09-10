import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = (env.VITE_API_URL || "http://127.0.0.1:3000").replace(
    /\/+$/,
    "",
  );

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@lmxcloud/shared": path.resolve(rootDir, "../../packages/shared/src/index.ts"),
      },
    },
    server: {
      port: 5175,
      host: "127.0.0.1",
      proxy: {
        "/v1": { target: apiTarget, changeOrigin: true },
      },
    },
  };
});
