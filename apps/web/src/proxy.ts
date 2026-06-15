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
 * Build the page-response Content-Security-Policy.
 *
 * `script-src` uses `'self' 'unsafe-inline'`. A per-request nonce +
 * `'strict-dynamic'` policy (A7-03) was tried but is incompatible with this
 * app's statically-optimized pages: Next.js can only stamp a per-request nonce
 * onto its scripts when a route is rendered dynamically, so on the prerendered
 * static HTML the framework's own scripts carried no nonce and `'strict-dynamic'`
 * blocked ALL of them — the app never hydrated (blank screen in the browser).
 * Re-introducing the nonce hardening would require forcing dynamic rendering on
 * every route AND validating it in a real browser first.
 *
 * `style-src` keeps `'unsafe-inline'`: Next.js + Tailwind emit inline `<style>`
 * tags and inline `style=` attributes that are not nonceable, so dropping it
 * would break rendering.
 */
function buildPageCsp(): string {
  const isDev = process.env.NODE_ENV === "development";
  const storageOrigins = env.CSP_STORAGE_ORIGINS ? ` ${env.CSP_STORAGE_ORIGINS}` : "";

  return [
    "default-src 'self'",
    // Scripts: 'self' + 'unsafe-inline' (+ 'unsafe-eval' in dev for React Fast
    // Refresh). See the function doc for why the nonce/strict-dynamic policy was
    // reverted — it broke hydration on statically-rendered pages.
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
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
 * @param csp the precomputed page CSP.
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

  const csp = buildPageCsp();
  const pageResponse = () => NextResponse.next();

  const token = request.cookies.get("token")?.value;
  const payload = token ? await getTokenPayload(token) : null;

  // Home page: authenticated users go to dashboard
  if (pathname === "/") {
    if (payload) {
      return addSecurityHeaders(NextResponse.redirect(new URL("/dashboard", request.url)), csp);
    }
    return addSecurityHeaders(pageResponse(), csp);
  }

  // Public paths
  const isPublic = matchesPath(pathname, publicPaths);
  if (isPublic) {
    // Unauthenticated-only paths redirect logged-in users to dashboard
    const isUnauthOnly = matchesPath(pathname, unauthenticatedOnlyPaths);
    if (isUnauthOnly && payload) {
      return addSecurityHeaders(NextResponse.redirect(new URL("/dashboard", request.url)), csp);
    }
    return addSecurityHeaders(pageResponse(), csp);
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

  return addSecurityHeaders(pageResponse(), csp);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt|manifest\\.webmanifest|e/).*)",
  ],
};
