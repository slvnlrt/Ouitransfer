import { jwtVerify } from "jose";
import { type NextRequest, NextResponse } from "next/server";

import { adminPaths } from "@/components/auth/paths/admin-paths";
import { matchesPath } from "@/components/auth/paths/match-path";
import { publicPaths } from "@/components/auth/paths/public-paths";
import { unauthenticatedOnlyPaths } from "@/components/auth/paths/unauthenticated-only-paths";
import { env } from "@/env";

interface TokenPayload {
  userId: string;
  isAdmin: boolean;
}

// Lazily encode the secret on first request — env.JWT_SECRET is validated
// by Zod on first access (min 32 chars, fail-fast at runtime).
// Deferred to avoid triggering env validation during `next build`'s
// module-discovery phase, where process.env may not contain all vars.
let _jwtSecretKey: Uint8Array | null = null;
function getJwtSecretKey(): Uint8Array {
  if (_jwtSecretKey) return _jwtSecretKey;
  _jwtSecretKey = new TextEncoder().encode(env.JWT_SECRET);
  return _jwtSecretKey;
}

/**
 * Extract the bare JWT from a potentially signed cookie value.
 *
 * @fastify/cookie with `signed: true` appends an HMAC signature to the cookie
 * value using the cookie-signature format: `value.base64_hmac`.
 * A JWT has exactly 3 dot-separated parts (header.payload.signature), so a
 * signed JWT cookie has 4 parts (header.payload.jwtSig.cookieHmac).
 *
 * This strips the 4th part if present, recovering the original JWT.
 * The proxy cannot unsign with COOKIE_SECRET (server-only), but it doesn't
 * need to — JWT integrity is verified independently via JWT_SECRET.
 */
function extractJwtFromSignedCookie(cookieValue: string): string {
  const parts = cookieValue.split(".");
  if (parts.length === 4) {
    return parts.slice(0, 3).join(".");
  }
  return cookieValue;
}

async function getTokenPayload(token: string): Promise<TokenPayload | null> {
  try {
    const jwt = extractJwtFromSignedCookie(token);
    const { payload } = await jwtVerify(jwt, getJwtSecretKey(), {
      algorithms: ["HS256"],
    });

    const userId = payload.userId as string | undefined;
    const isAdmin = payload.isAdmin as boolean | undefined;
    if (!userId) return null;
    return { userId, isAdmin: isAdmin === true };
  } catch {
    return null;
  }
}

/**
 * Generate a cryptographically-random, base64 per-request CSP nonce (A7-03).
 * Uses the Web Crypto API available in the Edge runtime.
 */
function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/**
 * Build the page-response Content-Security-Policy.
 *
 * `script-src` uses a per-request nonce + `'strict-dynamic'` instead of
 * `'unsafe-inline'` (A7-03): Next.js App Router auto-detects the nonce from the
 * request `Content-Security-Policy` header (set by the proxy) and stamps its
 * hydration/bootstrap inline scripts with it, so they execute while any injected
 * inline script is blocked. `'strict-dynamic'` lets those nonced scripts load
 * the chunk graph without needing a host allow-list. Browsers that honor a nonce
 * ignore `'self'` for `script-src`, but it is kept for the rare legacy fallback.
 *
 * `style-src` keeps `'unsafe-inline'`: Next.js + Tailwind emit inline `<style>`
 * tags and inline `style=` attributes (e.g. font-variable definitions, CSS-in-JS
 * critical styles) that are NOT nonced by the framework, and CSP nonces/hashes
 * do not cover inline style *attributes* at all. Dropping it would break
 * rendering. This is the documented, intentional trade-off (the priority per the
 * audit is `script-src`, which is now nonce-locked).
 */
function buildPageCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV === "development";
  const storageOrigins = env.CSP_STORAGE_ORIGINS ? ` ${env.CSP_STORAGE_ORIGINS}` : "";

  return [
    "default-src 'self'",
    // Scripts: nonce + strict-dynamic (drops 'unsafe-inline', A7-03).
    // Dev adds 'unsafe-eval' for React Fast Refresh (HMR) — never in production.
    `script-src 'nonce-${nonce}' 'strict-dynamic' 'self'${isDev ? " 'unsafe-eval'" : ""}`,
    // Styles: self + inline (required by Next/Tailwind inline styles — see doc above).
    "style-src 'self' 'unsafe-inline'",
    // Images: self + blob (preview) + data (QR codes) + storage origin (download/background).
    `img-src 'self' blob: data:${storageOrigins}`,
    // Fonts: self.
    "font-src 'self'",
    // Connect: self + storage origin (presigned upload endpoint).
    `connect-src 'self'${storageOrigins}`,
    // Plugins/embeds: none (A7-02 — close the object-src gap).
    "object-src 'none'",
    // Frames: self + blob: for the same-origin PDF preview <iframe src=blob:> (A7-02).
    "frame-src 'self' blob:",
    // Workers: self + blob: (web/service workers from blob URLs) (A7-02).
    "worker-src 'self' blob:",
    // Web app manifest: self (A7-02).
    "manifest-src 'self'",
    // Forms: self.
    "form-action 'self'",
    // Framing of this app: none (clickjacking).
    "frame-ancestors 'none'",
    // Base URI: self.
    "base-uri 'self'",
  ].join("; ");
}

/**
 * Add security headers to a response.
 * Applied to all responses from the proxy — covers Next.js frontend pages.
 * API responses are separately covered by @fastify/helmet on the server.
 *
 * @param csp the precomputed page CSP (carries the per-request nonce, A7-03).
 */
function addSecurityHeaders(response: NextResponse, csp: string): NextResponse {
  // Prevent MIME-type sniffing
  response.headers.set("X-Content-Type-Options", "nosniff");

  // Prevent clickjacking (defense-in-depth, server also sets via helmet)
  response.headers.set("X-Frame-Options", "DENY");

  // Control referrer information
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  // Restrict browser features
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()",
  );

  // CSP — the server already sets a strict CSP via helmet for API responses.
  // This CSP covers the Next.js frontend pages served by the web container.
  response.headers.set("Content-Security-Policy", csp);

  return response;
}

/**
 * Restrictive security headers for proxied `/api/*` responses (A3-03 / A7-07).
 *
 * The API can stream raw user-uploaded content (file downloads) same-origin with the app. The
 * server already forces `Content-Disposition: attachment` + `application/octet-stream` + nosniff
 * on those responses, but the web tier must also contribute a backstop here (previously the
 * rewrite was returned with NO security headers, so a server misconfig had no proxy fallback):
 *   - `Content-Security-Policy: sandbox` + `default-src 'none'` — neutralize any content that
 *     does get rendered (sandboxed, scriptless, no plugins/forms/navigation).
 *   - `X-Content-Type-Options: nosniff` — block MIME sniffing back to HTML.
 *   - `X-Frame-Options: DENY` / `frame-ancestors 'none'` — no framing of API responses.
 * The upstream target is `env.API_BASE_URL` (server-controlled, not client-influenced) — no SSRF.
 */
function addApiSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set(
    "Content-Security-Policy",
    ["sandbox", "default-src 'none'", "frame-ancestors 'none'", "base-uri 'none'"].join("; "),
  );
  return response;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // API Routing — proxy /api/* to the Fastify server.
  // In production with Traefik, this is never reached because Traefik
  // intercepts /api before it hits Next.js. Without Traefik (local dev,
  // docker-start), this provides the routing.
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    const targetPath = pathname.replace(/^\/api/, "");
    const rewriteUrl = new URL((targetPath || "/") + request.nextUrl.search, env.API_BASE_URL);
    return addApiSecurityHeaders(NextResponse.rewrite(rewriteUrl));
  }

  // Per-request CSP nonce (A7-03). Embedded in the `script-src` directive of the
  // page-response CSP and forwarded to the app on the request so Next.js App
  // Router stamps its hydration/bootstrap inline scripts with it.
  const nonce = generateNonce();
  const csp = buildPageCsp(nonce);

  // Forward the nonce to the rendered app. `NextResponse.next({ request })`
  // mutates the *request* headers seen by the route/layout. Next.js auto-detects
  // the nonce from the request `Content-Security-Policy` header and applies it to
  // the scripts it injects; `x-nonce` is also exposed for any app code that needs
  // it directly. (Next.js pattern for nonce-based CSP in the App Router.)
  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set("x-nonce", nonce);
  forwardedHeaders.set("Content-Security-Policy", csp);
  const nextWithNonce = () => NextResponse.next({ request: { headers: forwardedHeaders } });

  const token = request.cookies.get("token")?.value;
  const payload = token ? await getTokenPayload(token) : null;

  // Home page: authenticated users go to dashboard
  if (pathname === "/") {
    if (payload) {
      return addSecurityHeaders(NextResponse.redirect(new URL("/dashboard", request.url)), csp);
    }
    return addSecurityHeaders(nextWithNonce(), csp);
  }

  // Public paths
  const isPublic = matchesPath(pathname, publicPaths);
  if (isPublic) {
    // Unauthenticated-only paths redirect logged-in users to dashboard
    const isUnauthOnly = matchesPath(pathname, unauthenticatedOnlyPaths);
    if (isUnauthOnly && payload) {
      return addSecurityHeaders(NextResponse.redirect(new URL("/dashboard", request.url)), csp);
    }
    return addSecurityHeaders(nextWithNonce(), csp);
  }

  // Protected paths: require authentication
  if (!token) {
    return addSecurityHeaders(NextResponse.redirect(new URL("/login", request.url)), csp);
  }

  if (!payload) {
    // Token exists but is invalid/expired — clear it and redirect
    const response = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.delete("token");
    return addSecurityHeaders(response, csp);
  }

  // Admin-only paths
  const isAdminPath = matchesPath(pathname, adminPaths);
  if (isAdminPath && !payload.isAdmin) {
    return addSecurityHeaders(NextResponse.redirect(new URL("/dashboard", request.url)), csp);
  }

  return addSecurityHeaders(nextWithNonce(), csp);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt|manifest\\.webmanifest|e/).*)",
  ],
};
