import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 5173,
    // ws: true also proxies the /api/v1/ws WebSocket upgrade.
    proxy: { "/api": { target: process.env.API_URL || "http://localhost:8000", ws: true } },
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: { manualChunks: (id) => (id.includes("recharts") || id.includes("d3-") ? "charts" : undefined) },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.js",
    css: false,
  },
});
