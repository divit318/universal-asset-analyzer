import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "./auth-gate";
import {
  createAuthSession, createUser, deleteAuthSession, deleteOtherAuthSessions,
  getAuthSessionUser, getUserByEmail, getUserById, updateUserPassword, updateUserProfile,
  type UserRow,
} from "./db";

/**
 * Local-first authentication.
 *
 * UAA is a single-user product whose state lives in the owner's own SQLite
 * file, so the account follows the same rule: credentials are scrypt-hashed
 * into data/app.db (gitignored), sessions are opaque random tokens whose
 * SHA-256 — never the token itself — is stored server-side, and nothing here
 * talks to a network. There is no signing secret to configure or leak,
 * because there is nothing to sign: possession of the un-hashed token IS the
 * session, exactly like a password.
 *
 * The public surface is `AuthAdapter`, and every API route goes through
 * `auth()` (the active adapter) rather than the local implementation, so a
 * hosted backend (e.g. a cloud IdP for a multi-user deployment) can be swapped
 * in by providing another adapter without touching a route.
 *
 * Route gating is env-driven and OFF by default — see proxy.ts. The owner's
 * daily loop never sees a sign-in screen unless UAA_AUTH_GATE=on (the YC demo
 * flow: `npm run demo`).
 */

/** What the UI is allowed to know about a user. Never includes the hash. */
export interface PublicUser {
  id: number;
  email: string;
  displayName: string;
  createdAt: number;
}

export interface AuthAdapter {
  /** Create an account and open a session. Throws AuthError("email_taken"). */
  signUp(input: { email: string; displayName: string; password: string }): Promise<{ user: PublicUser; token: string }>;
  /** Verify credentials and open a session. Throws AuthError("invalid_credentials"). */
  signIn(input: { email: string; password: string }): Promise<{ user: PublicUser; token: string }>;
  /** Destroy one session. Unknown tokens are a no-op, not an error. */
  signOut(token: string): Promise<void>;
  /** Resolve a session token to its user, or null (expired / unknown). */
  sessionUser(token: string): Promise<PublicUser | null>;
  /** Update profile fields. Throws AuthError("email_taken"). */
  updateProfile(userId: number, patch: { email?: string; displayName?: string }): Promise<PublicUser>;
  /**
   * Change password after re-verifying the current one; revokes every other
   * session. Throws AuthError("invalid_credentials") on a wrong current password.
   */
  changePassword(input: { userId: number; token: string; currentPassword: string; newPassword: string }): Promise<void>;
}

export type AuthErrorCode = "email_taken" | "invalid_credentials";

/** Typed failure the API routes translate into status codes + readable copy. */
export class AuthError extends Error {
  constructor(public readonly code: AuthErrorCode) {
    super(code);
    this.name = "AuthError";
  }
}

/* ── Password hashing — scrypt via node:crypto, no dependency ────────────── */

const SCRYPT = { N: 16384, r: 8, p: 1, keyLen: 32 } as const;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, SCRYPT.keyLen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt:${SCRYPT.N}:${SCRYPT.r}:${SCRYPT.p}:${salt.toString("hex")}:${key.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltHex, keyHex] = parts;
  const expected = Buffer.from(keyHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length, {
    N: Number(n), r: Number(r), p: Number(p),
  });
  return timingSafeEqual(actual, expected);
}

/* ── Sessions ────────────────────────────────────────────────────────────── */

export { SESSION_COOKIE } from "./auth-gate";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — a personal tool, not a bank

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function toPublic(u: UserRow): PublicUser {
  return { id: u.id, email: u.email, displayName: u.displayName, createdAt: u.createdAt };
}

function openSession(user: UserRow): { user: PublicUser; token: string } {
  const token = randomBytes(32).toString("base64url");
  createAuthSession(hashToken(token), user.id, Date.now() + SESSION_TTL_MS);
  return { user: toPublic(user), token };
}

/* ── The local adapter ───────────────────────────────────────────────────── */

class LocalAuthAdapter implements AuthAdapter {
  async signUp({ email, displayName, password }: { email: string; displayName: string; password: string }) {
    if (getUserByEmail(email)) throw new AuthError("email_taken");
    const user = createUser(email, displayName, hashPassword(password));
    return openSession(user);
  }

  async signIn({ email, password }: { email: string; password: string }) {
    const user = getUserByEmail(email);
    // Hash even when the user is unknown, so response time does not reveal
    // which of the two fields was wrong.
    const ok = user
      ? verifyPassword(password, user.passwordHash)
      : (hashPassword(password), false);
    if (!user || !ok) throw new AuthError("invalid_credentials");
    return openSession(user);
  }

  async signOut(token: string) {
    deleteAuthSession(hashToken(token));
  }

  async sessionUser(token: string) {
    const user = getAuthSessionUser(hashToken(token));
    return user ? toPublic(user) : null;
  }

  async updateProfile(userId: number, patch: { email?: string; displayName?: string }) {
    if (patch.email !== undefined) {
      const existing = getUserByEmail(patch.email);
      if (existing && existing.id !== userId) throw new AuthError("email_taken");
    }
    updateUserProfile(userId, patch);
    return toPublic(getUserById(userId)!);
  }

  async changePassword({ userId, token, currentPassword, newPassword }: {
    userId: number; token: string; currentPassword: string; newPassword: string;
  }) {
    const user = getUserById(userId);
    if (!user || !verifyPassword(currentPassword, user.passwordHash)) {
      throw new AuthError("invalid_credentials");
    }
    updateUserPassword(userId, hashPassword(newPassword));
    deleteOtherAuthSessions(userId, hashToken(token));
  }
}

const localAdapter = new LocalAuthAdapter();

/** The active adapter. Swap the return value to change auth backends. */
export function auth(): AuthAdapter {
  return localAdapter;
}

/* ── Cookie helpers (Route Handlers / Server Components only) ────────────── */

export async function setSessionCookie(token: string): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.UAA_INSECURE_COOKIE !== "1",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/** The signed-in user for the current request, or null. */
export async function currentUser(): Promise<PublicUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return auth().sessionUser(token);
}

/** Current session token (needed by password change to keep its own session). */
export async function currentToken(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

/** Whether the signed-out gate is enabled. OFF by default (owner's daily loop). */
export function authGateEnabled(): boolean {
  return process.env.UAA_AUTH_GATE === "on" || process.env.UAA_AUTH_GATE === "1";
}
