/**
 * @vitest-environment node
 */
import { SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted values — available in vi.mock factories
// ---------------------------------------------------------------------------
const { TEST_SECRET, WRONG_SECRET, TEST_SECRET_KEY, WRONG_SECRET_KEY, BASE_URL } = vi.hoisted(
  () => {
    const TEST_SECRET = "a]#Fq9K!mZ3Tv&bW8xR2pL7jY0sN5dH6"; // 32+ chars
    const WRONG_SECRET = "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
    return {
      TEST_SECRET,
      WRONG_SECRET,
      TEST_SECRET_KEY: new TextEncoder().encode(TEST_SECRET),
      WRONG_SECRET_KEY: new TextEncoder().encode(WRONG_SECRET),
      BASE_URL: "http://localhost:3000",
    };
  },
);

// ---------------------------------------------------------------------------
// Mock fns — also hoisted so they can be used in vi.mock factories
// ---------------------------------------------------------------------------
const { mockRedirect, mockNext, mockCookiesDelete } = vi.hoisted(() => ({
  mockRedirect: vi.fn(),
  mockNext: vi.fn(),
  mockCookiesDelete: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Shared mock factory for next/server
// ---------------------------------------------------------------------------
function nextServerMockFactory() {
  class MockNextResponse {
    cookies = { delete: mockCookiesDelete };
    headers = new Map();
    status = 307;
  }
  return {
    NextRequest: vi.fn(),
    NextResponse: {
      redirect: (...args: unknown[]) => {
        mockRedirect(...args);
        return new MockNextResponse();
      },
      next: (...args: unknown[]) => {
        mockNext(...args);
        return new MockNextResponse();
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Mock next/server and env module
// ---------------------------------------------------------------------------
vi.mock("next/server", nextServerMockFactory);
vi.mock("@/env", () => ({
  env: { JWT_SECRET: TEST_SECRET },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a minimal NextRequest-like object for the middleware. */
function createRequest(
  path: string,
  token?: string,
): { nextUrl: { pathname: string }; url: string; cookies: { get: Mock } } {
  return {
    nextUrl: { pathname: path },
    url: `${BASE_URL}${path}`,
    cookies: {
      get: vi.fn((name: string) => (name === "token" && token ? { value: token } : undefined)),
    },
  };
}

/** Signs a JWT with HS256 using the given secret key. */
async function signToken(
  claims: Record<string, unknown>,
  secretKey: Uint8Array = TEST_SECRET_KEY,
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(secretKey);
}

/** Signs an already-expired JWT. */
async function signExpiredToken(
  claims: Record<string, unknown>,
  secretKey: Uint8Array = TEST_SECRET_KEY,
): Promise<string> {
  const pastExp = Math.floor(Date.now() / 1000) - 3600;
  return new SignJWT({ ...claims, exp: pastExp })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(pastExp - 3600)
    .sign(secretKey);
}

// ---------------------------------------------------------------------------
// Middleware tests — standard scenarios (JWT_SECRET is set correctly)
// ---------------------------------------------------------------------------
describe("middleware", () => {
  let middleware: (request: unknown) => Promise<unknown>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/middleware");
    middleware = mod.middleware as (request: unknown) => Promise<unknown>;
  });

  // -----------------------------------------------------------------------
  // Test 1: Unauthenticated access to protected path → redirect to /login
  // -----------------------------------------------------------------------
  it("redirects unauthenticated users on protected paths to /login", async () => {
    const req = createRequest("/dashboard");
    await middleware(req);

    expect(mockRedirect).toHaveBeenCalledTimes(1);
    const url = mockRedirect.mock.calls[0][0] as URL;
    expect(url.pathname).toBe("/login");
  });

  // -----------------------------------------------------------------------
  // Test 2: Valid JWT → access granted
  // -----------------------------------------------------------------------
  it("allows access with a valid JWT on protected paths", async () => {
    const token = await signToken({ userId: "user-1", isAdmin: false });
    const req = createRequest("/dashboard", token);
    await middleware(req);

    expect(mockNext).toHaveBeenCalledTimes(1);
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Test 2b: Signed cookie (Fastify cookie-signature format) → access granted
  // -----------------------------------------------------------------------
  it("allows access with a signed JWT cookie (jwt.cookieHmac format)", async () => {
    const token = await signToken({ userId: "user-1", isAdmin: false });
    // Simulate @fastify/cookie signed format: jwt_value.cookie_hmac_signature
    const signedToken = `${token}.fakeCookieHmacSignature123`;
    const req = createRequest("/dashboard", signedToken);
    await middleware(req);

    expect(mockNext).toHaveBeenCalledTimes(1);
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Test 3: Expired JWT → redirect to /login, cookie deleted
  // -----------------------------------------------------------------------
  it("rejects expired JWT, clears cookie, and redirects to /login", async () => {
    const token = await signExpiredToken({ userId: "user-1", isAdmin: false });
    const req = createRequest("/dashboard", token);
    await middleware(req);

    expect(mockRedirect).toHaveBeenCalledTimes(1);
    const url = mockRedirect.mock.calls[0][0] as URL;
    expect(url.pathname).toBe("/login");
    expect(mockCookiesDelete).toHaveBeenCalledWith("token");
  });

  // -----------------------------------------------------------------------
  // Test 5: Tampered JWT (signed with wrong key) → rejected
  // -----------------------------------------------------------------------
  it("rejects JWT signed with a wrong key", async () => {
    const token = await signToken({ userId: "user-1", isAdmin: false }, WRONG_SECRET_KEY);
    const req = createRequest("/dashboard", token);
    await middleware(req);

    expect(mockRedirect).toHaveBeenCalledTimes(1);
    const url = mockRedirect.mock.calls[0][0] as URL;
    expect(url.pathname).toBe("/login");
    expect(mockCookiesDelete).toHaveBeenCalledWith("token");
  });

  // -----------------------------------------------------------------------
  // Test 6: Path matching — /login is public, /loginadmin is NOT public
  // -----------------------------------------------------------------------
  it("treats /login as public (no auth required)", async () => {
    const req = createRequest("/login");
    await middleware(req);

    expect(mockNext).toHaveBeenCalledTimes(1);
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("treats /loginadmin as protected (requires auth)", async () => {
    const req = createRequest("/loginadmin");
    await middleware(req);

    expect(mockRedirect).toHaveBeenCalledTimes(1);
    const url = mockRedirect.mock.calls[0][0] as URL;
    expect(url.pathname).toBe("/login");
  });

  // -----------------------------------------------------------------------
  // Test 7: /s/xxx (share path with trailing slash in array) is public
  // -----------------------------------------------------------------------
  it("treats /s/xxx as public (share path)", async () => {
    const req = createRequest("/s/abc123");
    await middleware(req);

    expect(mockNext).toHaveBeenCalledTimes(1);
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("treats /s/ as public", async () => {
    const req = createRequest("/s/");
    await middleware(req);

    expect(mockNext).toHaveBeenCalledTimes(1);
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Test 8: Admin path — non-admin JWT → redirect to /dashboard
  // -----------------------------------------------------------------------
  it("redirects non-admin users from admin paths to /dashboard", async () => {
    const token = await signToken({ userId: "user-1", isAdmin: false });
    const req = createRequest("/settings", token);
    await middleware(req);

    expect(mockRedirect).toHaveBeenCalledTimes(1);
    const url = mockRedirect.mock.calls[0][0] as URL;
    expect(url.pathname).toBe("/dashboard");
  });

  it("redirects non-admin users from /users-management to /dashboard", async () => {
    const token = await signToken({ userId: "user-1", isAdmin: false });
    const req = createRequest("/users-management", token);
    await middleware(req);

    expect(mockRedirect).toHaveBeenCalledTimes(1);
    const url = mockRedirect.mock.calls[0][0] as URL;
    expect(url.pathname).toBe("/dashboard");
  });

  // -----------------------------------------------------------------------
  // Test 9: Admin path — admin JWT → access granted
  // -----------------------------------------------------------------------
  it("allows admin users to access admin paths", async () => {
    const token = await signToken({ userId: "admin-1", isAdmin: true });
    const req = createRequest("/settings", token);
    await middleware(req);

    expect(mockNext).toHaveBeenCalledTimes(1);
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("allows admin users to access /users-management", async () => {
    const token = await signToken({ userId: "admin-1", isAdmin: true });
    const req = createRequest("/users-management", token);
    await middleware(req);

    expect(mockNext).toHaveBeenCalledTimes(1);
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Test 10: Unauthenticated-only path with valid JWT → redirect to /dashboard
  // -----------------------------------------------------------------------
  it("redirects authenticated users from /login to /dashboard", async () => {
    const token = await signToken({ userId: "user-1", isAdmin: false });
    const req = createRequest("/login", token);
    await middleware(req);

    expect(mockRedirect).toHaveBeenCalledTimes(1);
    const url = mockRedirect.mock.calls[0][0] as URL;
    expect(url.pathname).toBe("/dashboard");
  });

  it("redirects authenticated users from /forgot-password to /dashboard", async () => {
    const token = await signToken({ userId: "user-1", isAdmin: false });
    const req = createRequest("/forgot-password", token);
    await middleware(req);

    expect(mockRedirect).toHaveBeenCalledTimes(1);
    const url = mockRedirect.mock.calls[0][0] as URL;
    expect(url.pathname).toBe("/dashboard");
  });

  // -----------------------------------------------------------------------
  // Additional edge cases
  // -----------------------------------------------------------------------
  it("redirects authenticated users on / to /dashboard", async () => {
    const token = await signToken({ userId: "user-1", isAdmin: false });
    const req = createRequest("/", token);
    await middleware(req);

    expect(mockRedirect).toHaveBeenCalledTimes(1);
    const url = mockRedirect.mock.calls[0][0] as URL;
    expect(url.pathname).toBe("/dashboard");
  });

  it("allows unauthenticated users on /", async () => {
    const req = createRequest("/");
    await middleware(req);

    expect(mockNext).toHaveBeenCalledTimes(1);
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("treats /login/subpath as public (matches with slash boundary)", async () => {
    const req = createRequest("/login/subpath");
    await middleware(req);

    expect(mockNext).toHaveBeenCalledTimes(1);
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("treats /settings/subpath as admin path", async () => {
    const token = await signToken({ userId: "user-1", isAdmin: false });
    const req = createRequest("/settings/subpath", token);
    await middleware(req);

    expect(mockRedirect).toHaveBeenCalledTimes(1);
    const url = mockRedirect.mock.calls[0][0] as URL;
    expect(url.pathname).toBe("/dashboard");
  });

  it("treats /settingspage as a regular protected path (not admin)", async () => {
    const token = await signToken({ userId: "user-1", isAdmin: false });
    const req = createRequest("/settingspage", token);
    await middleware(req);

    // Non-admin user on a non-admin path → should be allowed
    expect(mockNext).toHaveBeenCalledTimes(1);
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test 4: Mismatched JWT_SECRET — isolated in its own describe to avoid
// module cache pollution (requires vi.resetModules + vi.doMock).
// Note: The primary protection against missing JWT_SECRET is env.ts Zod
// validation (tested below). This test verifies that if the secret differs
// from the signing key, tokens are still rejected.
// ---------------------------------------------------------------------------
describe("middleware — mismatched JWT_SECRET", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rejects tokens when middleware secret differs from signing key", async () => {
    vi.resetModules();

    vi.doMock("@/env", () => ({
      env: { JWT_SECRET: WRONG_SECRET },
    }));
    vi.doMock("next/server", nextServerMockFactory);

    const { middleware } = await import("@/middleware");
    const token = await signToken({ userId: "user-1", isAdmin: false });
    const req = createRequest("/dashboard", token);
    await middleware(req as never);

    // Token signed with TEST_SECRET rejected by middleware using WRONG_SECRET
    expect(mockRedirect).toHaveBeenCalledTimes(1);
    const url = mockRedirect.mock.calls[0][0] as URL;
    expect(url.pathname).toBe("/login");
    expect(mockCookiesDelete).toHaveBeenCalledWith("token");
  });
});

// ---------------------------------------------------------------------------
// matchesPath unit tests
// ---------------------------------------------------------------------------
describe("matchesPath", () => {
  let matchesPath: (pathname: string, paths: readonly string[]) => boolean;

  beforeEach(async () => {
    const mod = await import("@/components/auth/paths/match-path");
    matchesPath = mod.matchesPath;
  });

  it("matches exact path", () => {
    expect(matchesPath("/login", ["/login"])).toBe(true);
  });

  it("matches path with trailing subpath", () => {
    expect(matchesPath("/login/extra", ["/login"])).toBe(true);
  });

  it("does not match path that shares prefix without slash boundary", () => {
    expect(matchesPath("/loginadmin", ["/login"])).toBe(false);
  });

  it("matches paths ending with slash (e.g. /s/)", () => {
    expect(matchesPath("/s/abc123", ["/s/"])).toBe(true);
  });

  it("matches exact path ending with slash", () => {
    expect(matchesPath("/s/", ["/s/"])).toBe(true);
  });

  it("does not match shorter path", () => {
    expect(matchesPath("/s", ["/s/"])).toBe(false);
  });

  it("returns false for empty paths array", () => {
    expect(matchesPath("/anything", [])).toBe(false);
  });

  it("matches first applicable path in array", () => {
    expect(matchesPath("/login", ["/register", "/login", "/other"])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// env.ts validation tests
//
// env.ts uses lazy validation via a Proxy — the Zod parse runs on first
// property access, not at import time. This means `import("@/env")` succeeds
// even when env vars are missing; the throw happens on `env.JWT_SECRET`.
// ---------------------------------------------------------------------------
describe("env validation", () => {
  it("throws on first access when JWT_SECRET is missing", async () => {
    const originalSecret = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;

    vi.resetModules();
    vi.doUnmock("@/env");

    try {
      const { env } = await import("@/env");
      // Import succeeds; accessing a property triggers validation
      expect(() => env.JWT_SECRET).toThrow();
    } finally {
      if (originalSecret !== undefined) {
        process.env.JWT_SECRET = originalSecret;
      }
    }
  });

  it("throws on first access when JWT_SECRET is too short", async () => {
    const originalSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "short";

    vi.resetModules();
    vi.doUnmock("@/env");

    try {
      const { env } = await import("@/env");
      expect(() => env.JWT_SECRET).toThrow();
    } finally {
      if (originalSecret !== undefined) {
        process.env.JWT_SECRET = originalSecret;
      } else {
        delete process.env.JWT_SECRET;
      }
    }
  });
});
