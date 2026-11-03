import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: Boolean(process.env.CI),
  workers: process.env.CI ? 2 : 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  projects: [
    { name: "model", testMatch: /model\.spec\.mjs$/ },
    { name: "browser", testIgnore: /model\.spec\.mjs$/ },
  ],
  use: {
    baseURL: "http://localhost:5840/grids/",
    viewport: { width: 1440, height: 1080 },
  },
  webServer:
    process.env.PLAYWRIGHT_SKIP_WEBSERVER === "1"
      ? undefined
      : {
          command: "npm run preview -- --port 5840 --strictPort --base /grids/",
          url: "http://localhost:5840/grids/",
          reuseExistingServer: false,
        },
});
