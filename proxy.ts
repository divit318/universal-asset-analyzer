import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth-gate";

/**
 * The signed-out gate — env-driven, OFF by default.
 *
 * UAA is a single-user local tool; its owner's daily loop must never see a
 * sign-in screen. The gate exists for the demo flow (landing → sign up →
 * terminal): `npm run demo` starts the dev server with UAA_AUTH_GATE=on, and
 * every app route then redirects signed-out visitors to /landing.
 *
 * This layer checks cookie *presence* only, deliberately: session validation
 * needs SQLite, and the account/settings surfaces plus every mutating API
 * route do validate the token server-side (lib/auth.ts). A forged cookie past
 * this check buys an unauthenticated visitor the page shell of a local app —
 * the same shell they get by turning the gate off. The gate is a front door,
 * not the vault.
 */

const PUBLIC_PREFIXES = [
  "/landing",
  "/api/auth", // sign in/up/out/session must work while signed out
];

export function proxy(request: NextRequest) {
  if (process.env.UAA_AUTH_GATE !== "on" && process.env.UAA_AUTH_GATE !== "1") {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  const landing = request.nextUrl.clone();
  landing.pathname = "/landing";
  landing.search = "";
  return NextResponse.redirect(landing);
}

export const config = {
  /* Everything except Next internals and static assets (anything with a file
     extension: brand SVGs, icons, fonts, screenshots). */
  matcher: ["/((?!_next/|.*\\..*).*)"],
};
