import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  workers: 1,
  use: {
    baseURL: "http://localhost:5840/tier-list/",
    viewport: { width: 1440, height: 1080 },
  },
  webServer: {
    command: "npm run preview -- --port 5840 --strictPort --base /tier-list/",
    url: "http://localhost:5840/tier-list/",
    reuseExistingServer: false,
  },
});
