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

// Encode the secret once at module level — env.JWT_SECRET is guaranteed
// present by Zod validation in env.ts (min 32 chars, fail-fast at import).
const JWT_SECRET_KEY = new TextEncoder().encode(env.JWT_SECRET);

async function getTokenPayload(token: string): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET_KEY, {
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
      // Scripts: self + inline for Next.js hydration (required by App Router)
      "script-src 'self' 'unsafe-inline'",
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
