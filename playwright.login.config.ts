import { defineConfig } from "@playwright/test";

/**
 * The login/auth suite — a second, isolated Playwright config so this
 * workstream never touches the primary suite's server or database:
 *
 *   - its own port (3121; the primary owns 3111 and is never reused here),
 *   - its own SQLite file (e2e/.tmp/login-e2e.db; global-setup cleans only
 *     that file, not the shared scratch directory),
 *   - UAA_AUTH_GATE=on, because these specs exist to test the gated demo
 *     flow (landing → sign up → terminal) and signed-out redirects.
 *
 * Run with:  npx playwright test --config playwright.login.config.ts
 */
process.env.UAA_E2E_DB = "e2e/.tmp/login-e2e.db";

export default defineConfig({
  testDir: "e2e",
  testMatch: ["auth.spec.ts", "settings.spec.ts", "landing-hero.spec.ts"],
  workers: 1,
  retries: 1,
  timeout: 45_000,
  globalSetup: "./e2e/global-setup.ts",
  use: { baseURL: "http://localhost:3121", viewport: { width: 1440, height: 900 } },
  webServer: {
    command: "npm run build && npm run start -- -p 3121",
    port: 3121,
    timeout: 300_000,
    reuseExistingServer: false,
    env: {
      DB_PATH: "e2e/.tmp/login-e2e.db",
      NODE_ENV: "production",
      UAA_AUTH_GATE: "on",
      // Same AI-off stance as the primary config: no key, degrade states only.
      ANTHROPIC_API_KEY: "",
      UAA_CONFIG_DIR: "e2e/.tmp/uaa-config-login",
    },
  },
});
