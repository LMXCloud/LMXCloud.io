import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = (env.VITE_API_URL || "http://127.0.0.1:3000").replace(
    /\/+$/,
    "",
  );

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5175,
      host: "127.0.0.1",
      proxy: {
        "/v1": { target: apiTarget, changeOrigin: true },
      },
    },
  };
});
