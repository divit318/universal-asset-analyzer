import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";

/**
 * Must match `webServer.env.DB_PATH` in playwright.config.ts. Kept as a
 * literal (not imported from the config) so this guard has no dependency on
 * the config module resolving correctly — it's the last line of defense
 * against the suite ever touching the user's real data/app.db.
 */
const DB_RELATIVE_PATH = "e2e/.tmp/e2e.db";

export default async function globalSetup(): Promise<void> {
  const tmpDir = path.resolve(process.cwd(), "e2e/.tmp");
  const resolvedDbPath = path.resolve(process.cwd(), DB_RELATIVE_PATH);

  if (!resolvedDbPath.startsWith(tmpDir + path.sep)) {
    throw new Error(
      `Refusing to run e2e suite: DB_PATH ("${DB_RELATIVE_PATH}") does not resolve inside e2e/.tmp/. ` +
        "This check exists so the suite can never write to the user's real data/app.db.",
    );
  }

  // Clean slate: delete any leftover e2e DB from a previous run.
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });
}
