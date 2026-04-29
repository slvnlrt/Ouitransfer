import { decodeJwt, jwtVerify } from "jose";
import { type NextRequest, NextResponse } from "next/server";

import { publicPaths } from "@/components/auth/paths/public-paths";
import { unauthenticatedOnlyPaths } from "@/components/auth/paths/unauthenticated-only-paths";

interface TokenPayload {
  userId: string;
  isAdmin: boolean;
}

const ADMIN_PATHS = ["/settings", "/users-management"];

async function getTokenPayload(token: string): Promise<TokenPayload | null> {
  try {
    const secret = process.env.JWT_SECRET;

    if (secret) {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
      const userId = payload.userId as string | undefined;
      const isAdmin = payload.isAdmin as boolean | undefined;
      if (!userId) return null;
      return { userId, isAdmin: isAdmin === true };
    }

    // Fallback: decode without verification (no secret configured)
    const payload = decodeJwt(token);
    if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) {
      return null;
    }
    const userId = payload.userId as string | undefined;
    if (!userId) return null;
    const isAdmin = payload.isAdmin as boolean | undefined;
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
  const isPublic = publicPaths.some((p) => pathname.startsWith(p));
  if (isPublic) {
    // Unauthenticated-only paths redirect logged-in users to dashboard
    const isUnauthOnly = unauthenticatedOnlyPaths.some((p) => pathname.startsWith(p));
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
  const isAdminPath = ADMIN_PATHS.some((p) => pathname.startsWith(p));
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
