import { mkdirSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import { randomBytes, scryptSync } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

/**
 * Must match `webServer.env.DB_PATH` in playwright.config.ts. Kept as a
 * literal (not imported from the config) so this guard has no dependency on
 * the config module resolving correctly — it's the last line of defense
 * against the suite ever touching the user's real data/app.db.
 *
 * A second suite (playwright.login.config.ts — the auth-gated server on
 * :3121) reuses this setup with `UAA_E2E_DB` pointing at its own file inside
 * e2e/.tmp/. In that mode only that one file is recreated, NOT the whole
 * directory, so the two suites can coexist in one checkout.
 */
const DB_RELATIVE_PATH = "e2e/.tmp/e2e.db";

/** The seeded account every suite can sign in with (also created in-UI by signup specs). */
export const E2E_USER = {
  email: "e2e-owner@uaa.local",
  displayName: "E2E Owner",
  password: "login-e2e-password-1",
} as const;

/**
 * Seed the test user directly into the SQLite file, before the server exists.
 *
 * The DDL below intentionally duplicates the `user` table from lib/db.ts
 * (CREATE TABLE IF NOT EXISTS on both sides makes the duplication safe at
 * runtime), and the hash format duplicates lib/auth.ts's
 * "scrypt:N:r:p:salt:key". If either drifts, sign-in specs fail loudly —
 * which is the desired failure mode for a contract this small.
 */
function seedUser(dbPath: string): void {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS user (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name  TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );
  `);
  const salt = randomBytes(16);
  const key = scryptSync(E2E_USER.password, salt, 32, { N: 16384, r: 8, p: 1 });
  const hash = `scrypt:16384:8:1:${salt.toString("hex")}:${key.toString("hex")}`;
  const now = Date.now();
  db.prepare(
    "INSERT OR IGNORE INTO user (email, display_name, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).run(E2E_USER.email, E2E_USER.displayName, hash, now, now);
  db.close();
}

export default async function globalSetup(): Promise<void> {
  const tmpDir = path.resolve(process.cwd(), "e2e/.tmp");
  const dbRelative = process.env.UAA_E2E_DB ?? DB_RELATIVE_PATH;
  const resolvedDbPath = path.resolve(process.cwd(), dbRelative);

  if (!resolvedDbPath.startsWith(tmpDir + path.sep)) {
    throw new Error(
      `Refusing to run e2e suite: DB_PATH ("${dbRelative}") does not resolve inside e2e/.tmp/. ` +
        "This check exists so the suite can never write to the user's real data/app.db.",
    );
  }

  if (process.env.UAA_E2E_DB) {
    // Secondary suite: clean only our own database file; another suite may be
    // live in the same directory.
    mkdirSync(tmpDir, { recursive: true });
    if (existsSync(resolvedDbPath)) rmSync(resolvedDbPath);
  } else {
    // Primary suite: clean slate for the whole scratch directory (original behaviour).
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });
  }

  seedUser(resolvedDbPath);
}
