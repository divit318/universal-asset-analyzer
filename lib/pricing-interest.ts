/**
 * Pro-tier interest capture — willingness-to-pay data for a tier that does
 * not exist yet.
 *
 * Stores {email, price preference, currency, timestamp} into the same local
 * SQLite file as the rest of the app (data/app.db, gitignored — verified
 * before this module was written). Deliberately NOT in lib/db.ts: that module
 * is owned by the auth workstream under the current file-ownership split, so
 * this one holds its own connection to the same file. SQLite handles multiple
 * connections; writes here are rare (a landing-page form), and a busy_timeout
 * covers the overlap window.
 *
 * Privacy: an email address and a price preference are the ONLY things
 * stored. No IP, no user agent, no analytics identifiers.
 */

import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type PricePreference = "monthly" | "annual" | "neither";

export interface PricingInterestRow {
  id: number;
  email: string;
  pricePreference: PricePreference | null;
  currency: "USD" | "INR";
  createdAt: string;
}

let db: DatabaseSync | null = null;

function getDb(): DatabaseSync {
  if (db) return db;
  const file = process.env.DB_PATH ?? path.join(process.cwd(), "data", "app.db");
  mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec("PRAGMA busy_timeout = 2000;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS pricing_interest (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      email            TEXT NOT NULL,
      price_preference TEXT,             -- 'monthly' | 'annual' | 'neither' | NULL (not answered)
      currency         TEXT NOT NULL,    -- 'USD' | 'INR' — which price card they were looking at
      created_at       TEXT NOT NULL     -- ISO timestamp
    );
  `);
  return db;
}

const PREFERENCES: readonly PricePreference[] = ["monthly", "annual", "neither"];

export function isPricePreference(v: unknown): v is PricePreference {
  return typeof v === "string" && (PREFERENCES as readonly string[]).includes(v);
}

/** Record one interest submission. Duplicate emails are allowed on purpose — a changed price preference over time is itself signal. */
export function recordPricingInterest(
  email: string,
  pricePreference: PricePreference | null,
  currency: "USD" | "INR",
): void {
  getDb()
    .prepare(
      "INSERT INTO pricing_interest (email, price_preference, currency, created_at) VALUES (?, ?, ?, ?)",
    )
    .run(email.trim().toLowerCase(), pricePreference, currency, new Date().toISOString());
}

/** Test hook: read rows back (newest first). */
export function listPricingInterest(limit = 50): PricingInterestRow[] {
  const rows = getDb()
    .prepare(
      "SELECT id, email, price_preference, currency, created_at FROM pricing_interest ORDER BY id DESC LIMIT ?",
    )
    .all(limit) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: r.id as number,
    email: r.email as string,
    pricePreference: (r.price_preference as PricePreference | null) ?? null,
    currency: r.currency as "USD" | "INR",
    createdAt: r.created_at as string,
  }));
}

/** Test hook: drop the connection so a test with its own DB_PATH re-opens. */
export function resetPricingInterestDbForTests(): void {
  db = null;
}
