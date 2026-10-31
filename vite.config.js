import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    host: "localhost",
    port: 5837,
    strictPort: false,
  },
  preview: {
    host: "localhost",
    port: 5838,
    strictPort: false,
  },
});
