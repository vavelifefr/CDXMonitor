import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// E3 UI build: webapp/ -> web/app/ (served by the local server, no CDN).
export default defineConfig({
  root: "webapp",
  plugins: [react()],
  build: {
    outDir: "../web/app",
    emptyOutDir: true,
  },
  server: {
    port: 51873,
    proxy: {
      "/api": "http://127.0.0.1:8765",
    },
  },
});
