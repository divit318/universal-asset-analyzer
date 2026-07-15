import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  workers: 1,
  retries: 1,
  timeout: 45_000,
  globalSetup: "./e2e/global-setup.ts",
  use: { baseURL: "http://localhost:3111", viewport: { width: 1440, height: 900 } },
  webServer: {
    command: "npm run build && npm run start -- -p 3111",
    port: 3111,
    timeout: 300_000,
    reuseExistingServer: false,
    env: { DB_PATH: "e2e/.tmp/e2e.db", NODE_ENV: "production" },
  },
});
