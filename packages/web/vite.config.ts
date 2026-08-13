import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  base: "./",
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3002",
        changeOrigin: true,
      },
    },
  },
});
