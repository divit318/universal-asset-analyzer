"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, User } from "lucide-react";
import { Dialog } from "@/app/_components/dialog";
import { Tabs, TabPanel } from "@/app/_components/ui/tabs";
import { PasswordInput } from "@/app/_components/ui/password-input";
import {
  passwordStrength, PASSWORD_MIN_LENGTH, validDisplayName, validEmail, validPassword,
} from "@/lib/auth-gate";
import { APP_ENTRY } from "../landing-config";

/**
 * The auth modal — Sign in / Create account over the landing page.
 *
 * Opening is event-based on purpose: the two triggers (the pill header's
 * "Sign in", the hero's "Get started") live in components this modal must not
 * force into one React subtree, and the landing layout is owned by another
 * workstream. `openAuthModal(tab)` dispatches; the single <AuthModalHost/>
 * (mounted by the landing header) listens. Focus return needs no bookkeeping:
 * the Dialog primitive restores whatever element was focused at open.
 *
 * Credential-manager contract (asserted by e2e/auth.spec.ts spec-17):
 * real <form onSubmit>, type="email" + autoComplete="username" +
 * inputMode="email" on email, current-password / new-password on the right
 * forms, a real <label htmlFor> on every input, submit buttons of
 * type="submit" so Enter submits from any field, and no :-webkit-autofill
 * restyling anywhere — the browser's tint stays legible in both themes.
 */

export type AuthTab = "signin" | "signup";

const OPEN_AUTH_EVENT = "uaa:open-auth";

export function openAuthModal(tab: AuthTab): void {
  window.dispatchEvent(new CustomEvent<{ tab: AuthTab }>(OPEN_AUTH_EVENT, { detail: { tab } }));
}

interface FieldErrors {
  name?: string;
  email?: string;
  password?: string;
  confirm?: string;
}

function inputClass(hasError: boolean): string {
  return `h-10 w-full rounded-control border bg-surface pl-9 pr-3 text-sm text-foreground placeholder:text-faint outline-none transition-colors focus:ring-2 disabled:opacity-60 ${
    hasError ? "border-negative focus:border-negative focus:ring-negative/25" : "border-border focus:border-brand focus:ring-brand/25"
  }`;
}

function FieldError({ id, children }: { id: string; children?: string }) {
  if (!children) return null;
  return <p id={id} className="mt-1.5 text-caption text-negative">{children}</p>;
}

export function AuthModalHost() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<AuthTab>("signin");

  // Shared across tabs so switching never loses a typed email.
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showRecoveryNote, setShowRecoveryNote] = useState(false);

  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const requested = (e as CustomEvent<{ tab: AuthTab }>).detail?.tab ?? "signin";
      setTab(requested);
      setOpen(true);
    };
    window.addEventListener(OPEN_AUTH_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_AUTH_EVENT, onOpen);
  }, []);

  // The Dialog primitive focuses its first focusable (the tab list); the spec
  // wants the first *field*. Child effects run before the parent's, so this
  // must wait a frame to win. Re-runs on tab switch, where refocusing the
  // email field is also the useful behaviour.
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => emailRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open, tab]);

  const close = useCallback(() => {
    if (submitting) return; // non-dismissable while a request is in flight
    setOpen(false);
    setErrors({});
    setFormError(null);
    setShowRecoveryNote(false);
    setPassword("");
    setConfirm("");
  }, [submitting]);

  const switchTab = (next: string) => {
    setTab(next as AuthTab);
    setErrors({});
    setFormError(null);
  };

  /* ── Validation (blur + submit; the API stays the authority) ─────────── */

  const validateField = useCallback((field: keyof FieldErrors, forSubmit = false): string | undefined => {
    switch (field) {
      case "name":
        if (!validDisplayName(name)) return "Enter a display name (2–60 characters).";
        return undefined;
      case "email":
        if (!validEmail(email)) return "Enter a valid email address.";
        return undefined;
      case "password":
        if (tab === "signup" && !validPassword(password)) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
        if (tab === "signin" && forSubmit && !password) return "Enter your password.";
        return undefined;
      case "confirm":
        if (confirm !== password) return "Passwords do not match.";
        return undefined;
    }
  }, [name, email, password, confirm, tab]);

  const onBlurValidate = (field: keyof FieldErrors) => () => {
    setErrors((prev) => ({ ...prev, [field]: validateField(field) }));
  };

  /* ── Submission ──────────────────────────────────────────────────────── */

  async function submit(kind: AuthTab) {
    const fields: (keyof FieldErrors)[] = kind === "signin" ? ["email", "password"] : ["name", "email", "password", "confirm"];
    const next: FieldErrors = {};
    for (const f of fields) {
      const err = validateField(f, true);
      if (err) next[f] = err;
    }
    setErrors(next);
    if (Object.values(next).some(Boolean)) return;

    setSubmitting(true);
    setFormError(null);
    try {
      const res = await fetch(kind === "signin" ? "/api/auth/signin" : "/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          kind === "signin"
            ? { email, password }
            : { email, displayName: name, password },
        ),
      });
      const data: { error?: string } = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(data.error ?? "The request failed — please try again.");
        return;
      }
      setOpen(false);
      router.push(APP_ENTRY);
      router.refresh();
    } catch {
      setFormError("Could not reach the local server. Is the app still running?");
    } finally {
      setSubmitting(false);
    }
  }

  const strength = passwordStrength(password);

  return (
    <Dialog
      open={open}
      onClose={close}
      title={tab === "signin" ? "Sign in" : "Create account"}
      description="Sign in to your local UAA account, or create one. The account lives in this machine's own database."
    >
      <Tabs
        idBase="auth-modal"
        tabs={[
          { id: "signin", label: "Sign in" },
          { id: "signup", label: "Create account" },
        ]}
        active={tab}
        onChange={switchTab}
      />

      {/* Auth errors — one readable line, announced politely. */}
      <div aria-live="polite" className="mt-4 empty:hidden">
        {formError && (
          <p className="rounded-control border border-negative/30 bg-negative/10 px-3 py-2 text-sm text-negative">
            {formError}
          </p>
        )}
      </div>

      {tab === "signin" && (
        <TabPanel idBase="auth-modal" tabId="signin">
          <form
            onSubmit={(e) => { e.preventDefault(); void submit("signin"); }}
            className="mt-4 flex flex-col gap-4"
            noValidate
          >
            <fieldset disabled={submitting} className="flex flex-col gap-4">
              <div>
                <label htmlFor="signin-email" className="mb-1.5 block text-caption font-medium text-muted">Email</label>
                <div className="relative">
                  <Mail aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" strokeWidth={1.75} />
                  <input
                    ref={emailRef}
                    id="signin-email"
                    name="email"
                    type="email"
                    inputMode="email"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onBlur={onBlurValidate("email")}
                    aria-invalid={errors.email ? true : undefined}
                    aria-describedby={errors.email ? "signin-email-error" : undefined}
                    className={inputClass(!!errors.email)}
                  />
                </div>
                <FieldError id="signin-email-error">{errors.email}</FieldError>
              </div>

              <div>
                <label htmlFor="signin-password" className="mb-1.5 block text-caption font-medium text-muted">Password</label>
                <PasswordInput
                  id="signin-password"
                  name="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onBlur={onBlurValidate("password")}
                  aria-invalid={errors.password ? true : undefined}
                  aria-describedby={errors.password ? "signin-password-error" : undefined}
                />
                <FieldError id="signin-password-error">{errors.password}</FieldError>
              </div>

              <button
                type="submit"
                className="inline-flex h-10 w-full items-center justify-center rounded-control bg-brand text-sm font-semibold text-background transition-colors hover:bg-brand-strong disabled:opacity-60"
              >
                {submitting ? "Signing in…" : "Sign in"}
              </button>
            </fieldset>

            <div className="flex flex-col gap-2 text-caption text-muted">
              <button
                type="button"
                onClick={() => setShowRecoveryNote((v) => !v)}
                aria-expanded={showRecoveryNote}
                className="self-start text-brand hover:underline"
              >
                Forgot password?
              </button>
              {showRecoveryNote && (
                /* TODO(owner): approve this local-recovery copy. There is no
                   email infrastructure in a local-first app, so a reset link
                   cannot exist; this states the honest recovery path. */
                <p className="rounded-control bg-surface-2 px-3 py-2 leading-relaxed">
                  This account lives in this machine&apos;s local database (<code className="font-mono">data/app.db</code>) —
                  there is no reset email. Recovery means editing that database directly.
                </p>
              )}
              <p>
                New to UAA?{" "}
                <button type="button" onClick={() => switchTab("signup")} className="text-brand hover:underline">
                  Create an account
                </button>
              </p>
            </div>
          </form>
        </TabPanel>
      )}

      {tab === "signup" && (
        <TabPanel idBase="auth-modal" tabId="signup">
          <form
            onSubmit={(e) => { e.preventDefault(); void submit("signup"); }}
            className="mt-4 flex flex-col gap-4"
            noValidate
          >
            <fieldset disabled={submitting} className="flex flex-col gap-4">
              <div>
                <label htmlFor="signup-name" className="mb-1.5 block text-caption font-medium text-muted">Display name</label>
                <div className="relative">
                  <User aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" strokeWidth={1.75} />
                  <input
                    id="signup-name"
                    name="name"
                    type="text"
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={onBlurValidate("name")}
                    aria-invalid={errors.name ? true : undefined}
                    aria-describedby={errors.name ? "signup-name-error" : undefined}
                    className={inputClass(!!errors.name)}
                  />
                </div>
                <FieldError id="signup-name-error">{errors.name}</FieldError>
              </div>

              <div>
                <label htmlFor="signup-email" className="mb-1.5 block text-caption font-medium text-muted">Email</label>
                <div className="relative">
                  <Mail aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" strokeWidth={1.75} />
                  <input
                    ref={tab === "signup" ? emailRef : undefined}
                    id="signup-email"
                    name="email"
                    type="email"
                    inputMode="email"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onBlur={onBlurValidate("email")}
                    aria-invalid={errors.email ? true : undefined}
                    aria-describedby={errors.email ? "signup-email-error" : undefined}
                    className={inputClass(!!errors.email)}
                  />
                </div>
                <FieldError id="signup-email-error">{errors.email}</FieldError>
              </div>

              <div>
                <label htmlFor="signup-password" className="mb-1.5 block text-caption font-medium text-muted">Password</label>
                <PasswordInput
                  id="signup-password"
                  name="new-password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onBlur={onBlurValidate("password")}
                  aria-invalid={errors.password ? true : undefined}
                  aria-describedby={errors.password ? "signup-password-error signup-password-strength" : "signup-password-strength"}
                />
                {/* Strength meter — informative, never a gate on its own. */}
                <div id="signup-password-strength" className="mt-1.5 flex items-center gap-2" aria-live="polite">
                  <span className="flex h-1 flex-1 gap-1" aria-hidden="true">
                    {[1, 2, 3].map((step) => (
                      <span
                        key={step}
                        className={`h-full flex-1 rounded-full transition-colors ${
                          strength.score >= step
                            ? strength.score === 1 ? "bg-negative" : strength.score === 2 ? "bg-warning" : "bg-positive"
                            : "bg-border"
                        }`}
                      />
                    ))}
                  </span>
                  {password.length > 0 && <span className="text-caption text-muted">{strength.label}</span>}
                </div>
                <FieldError id="signup-password-error">{errors.password}</FieldError>
              </div>

              <div>
                <label htmlFor="signup-confirm" className="mb-1.5 block text-caption font-medium text-muted">Confirm password</label>
                <PasswordInput
                  id="signup-confirm"
                  name="confirm-password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  onBlur={onBlurValidate("confirm")}
                  aria-invalid={errors.confirm ? true : undefined}
                  aria-describedby={errors.confirm ? "signup-confirm-error" : undefined}
                />
                <FieldError id="signup-confirm-error">{errors.confirm}</FieldError>
              </div>

              <button
                type="submit"
                className="inline-flex h-10 w-full items-center justify-center rounded-control bg-brand text-sm font-semibold text-background transition-colors hover:bg-brand-strong disabled:opacity-60"
              >
                {submitting ? "Creating account…" : "Create account"}
              </button>
            </fieldset>

            <p className="text-caption text-muted">
              Already have an account?{" "}
              <button type="button" onClick={() => switchTab("signin")} className="text-brand hover:underline">
                Sign in
              </button>
            </p>
          </form>
        </TabPanel>
      )}
    </Dialog>
  );
}
