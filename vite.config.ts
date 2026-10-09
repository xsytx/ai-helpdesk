import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Forward API and uploaded-image requests to the Go backend in dev.
    proxy: {
      "/api": process.env.BACKEND_URL ?? "http://localhost:8080",
      "/uploads": process.env.BACKEND_URL ?? "http://localhost:8080",
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Libraries change far less often than our code. Keeping them in their
        // own files lets browsers reuse the cached copy after each deploy.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return "react";
          if (id.includes("react-router")) return "router";
          return "vendor";
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
