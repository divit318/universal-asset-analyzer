/**
 * Client-safe (and proxy-safe) auth constants and validation.
 *
 * This module is importable from anywhere — proxy.ts, client components, API
 * routes — so it must stay free of node:crypto, node:sqlite and next/headers.
 * lib/auth.ts (server-only) re-exports what it shares.
 *
 * One definition of credential validity for the API routes (authority) and
 * the auth modal / settings forms (fast inline feedback).
 */

export const SESSION_COOKIE = "uaa_session";

/* Pragmatic RFC-lite: something@something.tld, no spaces. The authoritative
   dedup/normalisation happens in SQLite (COLLATE NOCASE unique). */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

export const PASSWORD_MIN_LENGTH = 8;

export function validPassword(password: string): boolean {
  return password.length >= PASSWORD_MIN_LENGTH;
}

export function validDisplayName(name: string): boolean {
  const t = name.trim();
  return t.length >= 2 && t.length <= 60;
}

/**
 * Coarse strength read for the sign-up meter. Deliberately simple and honest:
 * length is the dominant factor; variety nudges. Never blocks submission on
 * its own — `validPassword` is the gate.
 */
export function passwordStrength(password: string): { score: 0 | 1 | 2 | 3; label: "Too short" | "Weak" | "Good" | "Strong" } {
  if (password.length < PASSWORD_MIN_LENGTH) return { score: 0, label: "Too short" };
  let variety = 0;
  if (/[a-z]/.test(password)) variety++;
  if (/[A-Z]/.test(password)) variety++;
  if (/\d/.test(password)) variety++;
  if (/[^a-zA-Z0-9]/.test(password)) variety++;
  if (password.length >= 14 && variety >= 3) return { score: 3, label: "Strong" };
  if (password.length >= 10 && variety >= 2) return { score: 2, label: "Good" };
  return { score: 1, label: "Weak" };
}
