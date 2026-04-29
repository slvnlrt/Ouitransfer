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

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get("token")?.value;
  const payload = token ? await getTokenPayload(token) : null;

  // Home page: authenticated users go to dashboard
  if (pathname === "/") {
    if (payload) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    return NextResponse.next();
  }

  // Public paths
  const isPublic = matchesPath(pathname, publicPaths);
  if (isPublic) {
    // Unauthenticated-only paths redirect logged-in users to dashboard
    const isUnauthOnly = matchesPath(pathname, unauthenticatedOnlyPaths);
    if (isUnauthOnly && payload) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    return NextResponse.next();
  }

  // Protected paths: require authentication
  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (!payload) {
    // Token exists but is invalid/expired — clear it and redirect
    const response = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.delete("token");
    return response;
  }

  // Admin-only paths
  const isAdminPath = matchesPath(pathname, adminPaths);
  if (isAdminPath && !payload.isAdmin) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt|manifest\\.webmanifest|api/|e/).*)",
  ],
};
