import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5186",
    browserName: "chromium",
    channel: "msedge",
    headless: true,
    viewport: { width: 1440, height: 1100 },
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev -- --port 5186 --strictPort",
    url: "http://127.0.0.1:5186",
    reuseExistingServer: false,
  },
});
