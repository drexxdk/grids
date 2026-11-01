import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        onlyExplicitManualChunks: true,
        manualChunks(id) {
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) {
            return "react-vendor";
          }
          if (/\/node_modules\/(dexie|zod)\//.test(id)) {
            return "data-vendor";
          }
          if (
            /\/node_modules\/(@headlessui\/react|@floating-ui\/[^/]+|motion|framer-motion|motion-dom|motion-utils)\//.test(
              id,
            )
          ) {
            return "ui-vendor";
          }
        },
      },
    },
  },
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
