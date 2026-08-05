import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  // The login workstream's suite runs against its own gated server
  // (playwright.login.config.ts, :3121, UAA_AUTH_GATE=on) and declares these
  // via testMatch there; ignoring them here completes the partition so a bare
  // `npx playwright test` doesn't run gate-dependent specs on the ungated
  // :3111 server.
  testIgnore: ["auth.spec.ts", "settings.spec.ts", "landing-hero.spec.ts"],
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
    env: {
      DB_PATH: "e2e/.tmp/e2e.db",
      NODE_ENV: "production",
      // e2e is the designed AI-off environment: no key means AI panels must
      // render their degrade state, and no run can ever spend on a developer's
      // real Anthropic key that happens to be exported in the shell.
      ANTHROPIC_API_KEY: "",
      UAA_CONFIG_DIR: "e2e/.tmp/uaa-config",
    },
  },
});
