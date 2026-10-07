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
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
