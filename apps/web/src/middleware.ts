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
 * The middleware cannot unsign with COOKIE_SECRET (server-only), but it doesn't
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
 * Add security headers to a response.
 * Applied to all responses from the middleware — covers Next.js frontend pages.
 * API responses are separately covered by @fastify/helmet on the server.
 */
function addSecurityHeaders(response: NextResponse): NextResponse {
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
  response.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      // Scripts: self + inline for Next.js hydration (required by App Router).
      // Dev mode adds 'unsafe-eval' for React Fast Refresh (HMR) — blocked in production.
      `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
      // Styles: self + inline for Tailwind/styled components
      "style-src 'self' 'unsafe-inline'",
      // Images: self + blob (for preview) + data (for QR codes) + storage URL
      "img-src 'self' blob: data:",
      // Fonts: self
      "font-src 'self'",
      // Connect: self + any additional sources (e.g., storage endpoint for presigned URL uploads)
      `connect-src 'self'${env.CSP_CONNECT_SOURCES ? ` ${env.CSP_CONNECT_SOURCES}` : ""}`,
      // Forms: self
      "form-action 'self'",
      // Frames: none
      "frame-ancestors 'none'",
      // Base URI: self
      "base-uri 'self'",
    ].join("; "),
  );

  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get("token")?.value;
  const payload = token ? await getTokenPayload(token) : null;

  // Home page: authenticated users go to dashboard
  if (pathname === "/") {
    if (payload) {
      return addSecurityHeaders(NextResponse.redirect(new URL("/dashboard", request.url)));
    }
    return addSecurityHeaders(NextResponse.next());
  }

  // Public paths
  const isPublic = matchesPath(pathname, publicPaths);
  if (isPublic) {
    // Unauthenticated-only paths redirect logged-in users to dashboard
    const isUnauthOnly = matchesPath(pathname, unauthenticatedOnlyPaths);
    if (isUnauthOnly && payload) {
      return addSecurityHeaders(NextResponse.redirect(new URL("/dashboard", request.url)));
    }
    return addSecurityHeaders(NextResponse.next());
  }

  // Protected paths: require authentication
  if (!token) {
    return addSecurityHeaders(NextResponse.redirect(new URL("/login", request.url)));
  }

  if (!payload) {
    // Token exists but is invalid/expired — clear it and redirect
    const response = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.delete("token");
    return addSecurityHeaders(response);
  }

  // Admin-only paths
  const isAdminPath = matchesPath(pathname, adminPaths);
  if (isAdminPath && !payload.isAdmin) {
    return addSecurityHeaders(NextResponse.redirect(new URL("/dashboard", request.url)));
  }

  return addSecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt|manifest\\.webmanifest|api/|e/).*)",
  ],
};
