import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  // Empty prefix: read non-VITE_ variables too. API_PROXY_TARGET is used here only and never reaches the bundle.
  const env = loadEnv(mode, process.cwd(), "");
  const proxyTarget = env.API_PROXY_TARGET;

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    server: {
      // People Hub uses 5173; both run side by side.
      port: 5174,
      strictPort: true,
      proxy: proxyTarget
        ? {
            "/api": { target: proxyTarget, changeOrigin: true },
            "/hubs": { target: proxyTarget, changeOrigin: true, ws: true },
          }
        : undefined,
    },
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test/setup.js"],
      // Some page tests run several debounced searches; 5 s is too tight on a loaded run.
      testTimeout: 15_000,
      include: ["src/**/*.test.{js,jsx}", "scripts/**/*.test.js"],
    },
  };
});
