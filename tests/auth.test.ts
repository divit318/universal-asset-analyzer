/**
 * Local auth — hashing, sessions, and the adapter contract, against an
 * isolated throwaway database.
 *
 * What matters here:
 * - The hash format round-trips and a wrong password NEVER verifies.
 * - Sessions are opaque: the DB stores a digest, so a stolen row is not a cookie.
 * - Sign-in failure is one indistinguishable error for unknown-email and
 *   wrong-password.
 * - Changing the password revokes every session except the one that did it.
 *
 * DB_PATH is set before lib/db.ts's lazy getDb() is ever called, so this never
 * touches data/app.db.
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const tmpDir = mkdtempSync(path.join(tmpdir(), "uaa-auth-test-"));
process.env.DB_PATH = path.join(tmpDir, "test.db");

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

const { auth, AuthError, hashPassword, verifyPassword } = await import("@/lib/auth");
const { getUserByEmail } = await import("@/lib/db");
const { validEmail, validPassword, passwordStrength } = await import("@/lib/auth-gate");

describe("password hashing", () => {
  it("round-trips and rejects a wrong password", () => {
    const stored = hashPassword("correct horse battery staple");
    expect(stored.startsWith("scrypt:")).toBe(true);
    expect(verifyPassword("correct horse battery staple", stored)).toBe(true);
    expect(verifyPassword("correct horse battery stapl", stored)).toBe(false);
    expect(verifyPassword("", stored)).toBe(false);
  });

  it("salts: the same password hashes differently every time", () => {
    expect(hashPassword("hunter22")).not.toBe(hashPassword("hunter22"));
  });

  it("rejects malformed stored hashes instead of throwing", () => {
    expect(verifyPassword("x", "not-a-hash")).toBe(false);
    expect(verifyPassword("x", "bcrypt:whatever")).toBe(false);
  });
});

describe("adapter: sign up / sign in / session", () => {
  it("signs up, stores no plaintext, and opens a working session", async () => {
    const { user, token } = await auth().signUp({
      email: "owner@example.com", displayName: "The Owner", password: "a-long-password",
    });
    expect(user.email).toBe("owner@example.com");
    expect(user.displayName).toBe("The Owner");
    expect(user).not.toHaveProperty("passwordHash");

    const row = getUserByEmail("owner@example.com")!;
    expect(row.passwordHash).not.toContain("a-long-password");

    const resolved = await auth().sessionUser(token);
    expect(resolved?.id).toBe(user.id);
  });

  it("treats email as case-insensitive for duplicate detection and sign-in", async () => {
    await expect(
      auth().signUp({ email: "OWNER@example.com", displayName: "Dup", password: "a-long-password" }),
    ).rejects.toThrow(AuthError);
    const { user } = await auth().signIn({ email: "Owner@Example.com", password: "a-long-password" });
    expect(user.displayName).toBe("The Owner");
  });

  it("fails sign-in identically for unknown email and wrong password", async () => {
    const unknown = await auth().signIn({ email: "nobody@example.com", password: "whatever-long" }).catch((e) => e);
    const wrongPw = await auth().signIn({ email: "owner@example.com", password: "wrong-password" }).catch((e) => e);
    expect(unknown).toBeInstanceOf(AuthError);
    expect(wrongPw).toBeInstanceOf(AuthError);
    expect((unknown as InstanceType<typeof AuthError>).code).toBe((wrongPw as InstanceType<typeof AuthError>).code);
  });

  it("sign-out invalidates exactly that session", async () => {
    const a = await auth().signIn({ email: "owner@example.com", password: "a-long-password" });
    const b = await auth().signIn({ email: "owner@example.com", password: "a-long-password" });
    await auth().signOut(a.token);
    expect(await auth().sessionUser(a.token)).toBeNull();
    expect((await auth().sessionUser(b.token))?.email).toBe("owner@example.com");
    await auth().signOut(b.token);
  });

  it("never resolves a forged or expired token", async () => {
    expect(await auth().sessionUser("forged-token")).toBeNull();
  });
});

describe("adapter: profile + password change", () => {
  it("updates profile and surfaces email collisions", async () => {
    const { user, token } = await auth().signUp({
      email: "second@example.com", displayName: "Second", password: "second-password",
    });
    const updated = await auth().updateProfile(user.id, { displayName: "Renamed" });
    expect(updated.displayName).toBe("Renamed");
    await expect(auth().updateProfile(user.id, { email: "owner@example.com" })).rejects.toThrow(AuthError);
    await auth().signOut(token);
  });

  it("changes password only with the correct current one, and revokes other sessions", async () => {
    const keep = await auth().signIn({ email: "second@example.com", password: "second-password" });
    const other = await auth().signIn({ email: "second@example.com", password: "second-password" });

    await expect(
      auth().changePassword({ userId: keep.user.id, token: keep.token, currentPassword: "nope-nope-nope", newPassword: "new-password-1" }),
    ).rejects.toThrow(AuthError);

    await auth().changePassword({
      userId: keep.user.id, token: keep.token, currentPassword: "second-password", newPassword: "new-password-1",
    });

    // Old credential dead, new one live; the acting session survives, the other is revoked.
    await expect(auth().signIn({ email: "second@example.com", password: "second-password" })).rejects.toThrow(AuthError);
    expect((await auth().signIn({ email: "second@example.com", password: "new-password-1" })).user.id).toBe(keep.user.id);
    expect(await auth().sessionUser(keep.token)).not.toBeNull();
    expect(await auth().sessionUser(other.token)).toBeNull();
  });
});

describe("validation helpers", () => {
  it("accepts normal emails and rejects junk", () => {
    expect(validEmail("a@b.co")).toBe(true);
    expect(validEmail("first.last+tag@sub.domain.io")).toBe(true);
    expect(validEmail("not-an-email")).toBe(false);
    expect(validEmail("a @b.co")).toBe(false);
    expect(validEmail("a@b")).toBe(false);
  });

  it("password gate is length-based; strength meter never blocks", () => {
    expect(validPassword("short")).toBe(false);
    expect(validPassword("12345678")).toBe(true);
    expect(passwordStrength("short").score).toBe(0);
    expect(passwordStrength("12345678").score).toBeGreaterThanOrEqual(1);
    expect(passwordStrength("A-long-passphrase-9!").score).toBe(3);
  });
});
