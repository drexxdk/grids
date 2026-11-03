import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false,
      manifest: {
        id: "./",
        name: "Grids",
        short_name: "Grids",
        description:
          "Create and export image grids with your own captions, crops and styles.",
        start_url: "./",
        scope: "./",
        display: "standalone",
        theme_color: "#171a1c",
        background_color: "#171a1c",
        icons: [
          {
            src: "assets/grids-icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          { src: "assets/grids-icon.png", sizes: "512x512", type: "image/png" },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api(?:\/|$)/],
        globPatterns: ["**/*.{html,js,css,woff2,png,svg}"],
        dontCacheBustURLsMatching: /-[A-Za-z0-9_-]{8}\.(?:js|css)$/,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
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
    proxy: { "/api": "http://localhost:5841" },
  },
  preview: {
    host: "localhost",
    port: 5838,
    strictPort: false,
  },
});
