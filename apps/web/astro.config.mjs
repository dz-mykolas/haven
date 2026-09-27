import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

// Keep the browser host so the API can validate bank callback cookie origins.
const apiProxy = {
  target: process.env.HAVEN_API_URL || "http://127.0.0.1:8080",
  changeOrigin: false,
};

export default defineConfig({
  integrations: [react()],
  output: "static",
  devToolbar: { enabled: false },
  server: { port: 4321 },
  vite: {
    plugins: [tailwindcss()],
    server: {
      strictPort: true,
      proxy: { "/api": apiProxy },
    },
    preview: {
      proxy: { "/api": apiProxy },
    },
  },
});
