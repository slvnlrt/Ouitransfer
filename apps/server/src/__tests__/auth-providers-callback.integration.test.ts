/**
 * auth-providers-callback.integration.test.ts
 *
 * Full-lifecycle integration tests for the OAuth/OIDC callback (R4a) via
 * app.inject(). Exercises the browser-bound flow cookie, id_token verification,
 * account-linking guard, server-fixed redirect, and SSRF guard end-to-end.
 *
 * Covers:
 *   A5-03 — mismatched / replayed / missing-cookie state → rejected
 *   A5-01 — id_token signature / iss / aud / nonce failure → rejected; valid → login
 *   A5-02 — callback that would link to an existing local account by unverified
 *           email → rejected (not logged in)
 *   A5-04 — client-supplied redirect_uri is ignored (server-fixed callback)
 *   A5-05 — SSRF-guarded fetch rejects an internal token/jwks host
 */

import type { FastifyInstance } from "fastify";
import * as jose from "jose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const APP_URL = "https://transfer.example.com";
const ISSUER = "https://idp.example.com";
const CLIENT_ID = "client-abc";
const JWKS_URI = "https://idp.example.com/jwks";

// ── Prisma mock ──────────────────────────────────────────────────────────────
const {
  mockAuthProviderFindFirst,
  mockUserAuthProviderFindUnique,
  mockUserAuthProviderFindFirst,
  mockUserAuthProviderCreate,
  mockUserFindUnique,
  mockUserUpdate,
  mockUserCreate,
  mockUserCount,
  mockRefreshTokenCreate,
} = vi.hoisted(() => ({
  mockAuthProviderFindFirst: vi.fn(),
  mockUserAuthProviderFindUnique: vi.fn(),
  mockUserAuthProviderFindFirst: vi.fn(),
  mockUserAuthProviderCreate: vi.fn(),
  mockUserFindUnique: vi.fn(),
  mockUserUpdate: vi.fn(),
  mockUserCreate: vi.fn(),
  mockUserCount: vi.fn(),
  mockRefreshTokenCreate: vi.fn(),
}));

vi.mock("../shared/prisma.js", () => ({
  prisma: {
    authProvider: { findFirst: mockAuthProviderFindFirst, findMany: vi.fn() },
    userAuthProvider: {
      findUnique: mockUserAuthProviderFindUnique,
      findFirst: mockUserAuthProviderFindFirst,
      create: mockUserAuthProviderCreate,
    },
    user: {
      findUnique: mockUserFindUnique,
      update: mockUserUpdate,
      create: mockUserCreate,
      count: mockUserCount,
    },
    refreshToken: { create: mockRefreshTokenCreate },
  },
}));

// appUrl config — the callback derives every base URL from this, never the Host.
vi.mock("../modules/config/service.js", () => ({
  getConfigValue: vi.fn(async (key: string) => {
    if (key === "appUrl") return APP_URL;
    if (key === "maxFileSize") return String(100 * 1024 * 1024);
    if (key === "maxTotalStoragePerUser") return String(1024 * 1024 * 1024);
    if (key === "passwordMinLength") return "8";
    return "true";
  }),
  validatePasswordAuthDisable: vi.fn().mockResolvedValue(true),
  validateAllProvidersDisable: vi.fn().mockResolvedValue(true),
}));

vi.mock("../modules/auth/token-version.js", () => ({
  validateTokenVersion: vi.fn().mockResolvedValue(true),
  invalidateTokenVersionCache: vi.fn(),
  incrementTokenVersion: vi.fn(),
}));

vi.mock("../modules/audit/service.js", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../modules/email/service.js", () => ({
  emailService: { sendToAdmins: vi.fn().mockResolvedValue(undefined) },
}));

// ── Crypto fixtures: a real RSA key pair to sign id_tokens ───────────────────
let signingKey: jose.KeyLike;
let publicJwk: jose.JWK;
const KID = "test-kid-1";

async function makeKeys() {
  const { privateKey, publicKey } = await jose.generateKeyPair("RS256");
  signingKey = privateKey;
  publicJwk = { ...(await jose.exportJWK(publicKey)), kid: KID, alg: "RS256", use: "sig" };
}

function discoveryDoc(overrides: Record<string, unknown> = {}) {
  return {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/authorize`,
    token_endpoint: `${ISSUER}/token`,
    userinfo_endpoint: `${ISSUER}/userinfo`,
    jwks_uri: JWKS_URI,
    ...overrides,
  };
}

interface FetchScenario {
  discovery?: Record<string, unknown>;
  idToken?: string;
  tokenStatus?: number;
  jwks?: jose.JWK[];
  tokenEndpoint?: string;
  jwksUri?: string;
}

/** Install a global fetch stub that serves discovery, token, and JWKS responses. */
function stubFetch(scenario: FetchScenario) {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url.includes("/.well-known/")) {
        return json(scenario.discovery ?? discoveryDoc());
      }
      if (url === (scenario.tokenEndpoint ?? `${ISSUER}/token`)) {
        if (scenario.tokenStatus && scenario.tokenStatus >= 400) {
          return json({ error: "invalid_grant" }, scenario.tokenStatus);
        }
        return json({ access_token: "at-123", token_type: "Bearer", id_token: scenario.idToken });
      }
      if (url === (scenario.jwksUri ?? JWKS_URI)) {
        return json({ keys: scenario.jwks ?? [publicJwk] });
      }
      throw new Error(`unexpected fetch in test: ${url}`);
    }),
  );
}

async function signId(
  claims: Record<string, unknown>,
  opts: { iss?: string; aud?: string; key?: jose.KeyLike } = {},
): Promise<string> {
  return new jose.SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuedAt()
    .setIssuer(opts.iss ?? ISSUER)
    .setAudience(opts.aud ?? CLIENT_ID)
    .setExpirationTime("5m")
    .sign(opts.key ?? signingKey);
}

function oidcProvider() {
  return {
    id: "prov-oidc",
    name: "customidp",
    displayName: "Custom IdP",
    type: "oidc",
    enabled: true,
    autoRegister: true,
    scope: "openid profile email",
    adminEmailDomains: null,
    clientId: CLIENT_ID,
    clientSecret: "secret",
    issuerUrl: ISSUER,
    authorizationEndpoint: null,
    tokenEndpoint: null,
    userInfoEndpoint: null,
    redirectUri: null,
    icon: null,
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ── Suite ────────────────────────────────────────────────────────────────────
describe("OAuth/OIDC callback — integration", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await makeKeys();
    const { buildApp } = await import("../app.js");
    app = await buildApp();
    const { authProvidersRoutes } = await import("../modules/auth-providers/routes.js");
    app.register(authProvidersRoutes, { prefix: "/auth" });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    mockAuthProviderFindFirst.mockResolvedValue(oidcProvider());
    mockUserAuthProviderFindUnique.mockResolvedValue(null);
    mockUserAuthProviderFindFirst.mockResolvedValue(null);
    mockUserFindUnique.mockResolvedValue(null);
    mockUserCount.mockResolvedValue(2);
    mockRefreshTokenCreate.mockResolvedValue({ id: "rt-1" });
    mockUserCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "new-user-1",
      isAdmin: false,
      tokenVersion: 0,
      ...data,
    }));
    mockUserUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "local-1",
      isAdmin: false,
      tokenVersion: 0,
      email: "victim@corp.com",
      ...data,
    }));
  });

  /** Run /authorize, capture the flow cookie + the state we generated. */
  async function startFlow(): Promise<{ cookie: string; state: string }> {
    stubFetch({ discovery: discoveryDoc() });
    const res = await app.inject({
      method: "GET",
      url: "/auth/providers/customidp/authorize",
    });
    expect(res.statusCode).toBe(302);
    const location = res.headers.location as string;
    const state = new URL(location).searchParams.get("state");
    expect(state).toBeTruthy();
    const setCookie = res.headers["set-cookie"];
    const raw = Array.isArray(setCookie) ? setCookie.join(";") : (setCookie ?? "");
    const m = raw.match(/oauth_flow=([^;]+)/);
    expect(m).toBeTruthy();
    return { cookie: `oauth_flow=${m?.[1]}`, state: state as string };
  }

  function isLoginRedirect(location: string): boolean {
    return location.startsWith(`${APP_URL}/login`);
  }

  // ── A5-04: client redirect_uri is ignored ─────────────────────────────────
  it("authorize ignores a client-supplied redirect_uri and fixes it to appUrl", async () => {
    stubFetch({ discovery: discoveryDoc() });
    const res = await app.inject({
      method: "GET",
      url: "/auth/providers/customidp/authorize?redirect_uri=https://evil.tld/steal",
    });
    expect(res.statusCode).toBe(302);
    const authUrl = new URL(res.headers.location as string);
    expect(authUrl.searchParams.get("redirect_uri")).toBe(
      `${APP_URL}/api/auth/providers/customidp/callback`,
    );
    // PKCE is always present (A5-06) and a nonce is bound for OIDC (A5-01/03).
    expect(authUrl.searchParams.get("code_challenge")).toBeTruthy();
    expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authUrl.searchParams.get("nonce")).toBeTruthy();
  });

  // ── A5-03: state binding ──────────────────────────────────────────────────
  it("rejects a callback with no flow cookie (browser binding)", async () => {
    const { state } = await startFlow();
    stubFetch({ discovery: discoveryDoc(), idToken: await signId({ sub: "x", nonce: "n" }) });

    const res = await app.inject({
      method: "GET",
      url: `/auth/providers/customidp/callback?code=abc&state=${state}`,
      // no cookie attached
    });
    expect(res.statusCode).toBe(302);
    expect(isLoginRedirect(res.headers.location as string)).toBe(true);
    expect(res.headers.location).toContain("error=");
  });

  it("rejects a callback whose state does not match the cookie (forced-login / CSRF)", async () => {
    const { cookie } = await startFlow();
    stubFetch({ discovery: discoveryDoc(), idToken: await signId({ sub: "x", nonce: "n" }) });

    const res = await app.inject({
      method: "GET",
      url: "/auth/providers/customidp/callback?code=abc&state=attacker-chosen-state",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(302);
    expect(isLoginRedirect(res.headers.location as string)).toBe(true);
  });

  it("clears the flow cookie on the callback (single-use enforcement)", async () => {
    const flow = await startFlowWithNonce();
    stubFetch({
      discovery: discoveryDoc(),
      idToken: await signId({
        sub: "u1",
        email: "a@b.com",
        email_verified: true,
        nonce: flow.nonce,
      }),
    });

    const res = await app.inject({
      method: "GET",
      url: `/auth/providers/customidp/callback?code=abc&state=${flow.state}`,
      headers: { cookie: flow.cookie },
    });

    // The callback response must clear the oauth_flow cookie so the browser
    // drops it — a replay is then impossible (the cookie is the only binding).
    const setCookie = res.headers["set-cookie"];
    const raw = Array.isArray(setCookie) ? setCookie.join(";") : (setCookie ?? "");
    expect(raw).toMatch(/oauth_flow=/);
    expect(raw).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/i);
  });

  // ── A5-01: id_token verification ──────────────────────────────────────────
  it("rejects an id_token signed by an unrelated key (bad signature)", async () => {
    const { cookie, state } = await startFlow();
    const { privateKey: otherKey } = await jose.generateKeyPair("RS256");
    stubFetch({
      discovery: discoveryDoc(),
      idToken: await signId({ sub: "u", email: "a@b.com", nonce: "n" }, { key: otherKey }),
    });

    const res = await app.inject({
      method: "GET",
      url: `/auth/providers/customidp/callback?code=abc&state=${state}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(302);
    expect(isLoginRedirect(res.headers.location as string)).toBe(true);
  });

  it("rejects an id_token with the wrong issuer", async () => {
    const { cookie, state } = await startFlow();
    stubFetch({
      discovery: discoveryDoc(),
      idToken: await signId({ sub: "u", email: "a@b.com", nonce: "n" }, { iss: "https://evil" }),
    });
    const res = await app.inject({
      method: "GET",
      url: `/auth/providers/customidp/callback?code=abc&state=${state}`,
      headers: { cookie },
    });
    expect(isLoginRedirect(res.headers.location as string)).toBe(true);
  });

  it("rejects an id_token with the wrong audience", async () => {
    const { cookie, state } = await startFlow();
    stubFetch({
      discovery: discoveryDoc(),
      idToken: await signId({ sub: "u", email: "a@b.com", nonce: "n" }, { aud: "other-client" }),
    });
    const res = await app.inject({
      method: "GET",
      url: `/auth/providers/customidp/callback?code=abc&state=${state}`,
      headers: { cookie },
    });
    expect(isLoginRedirect(res.headers.location as string)).toBe(true);
  });

  it("rejects an id_token whose nonce was not bound to this flow", async () => {
    const { cookie, state } = await startFlow();
    // A wrong nonce: even with a perfectly valid signature/iss/aud the binding
    // check must reject it.
    stubFetch({
      discovery: discoveryDoc(),
      idToken: await signId({ sub: "u", email: "a@b.com", nonce: "totally-wrong-nonce" }),
    });
    const res = await app.inject({
      method: "GET",
      url: `/auth/providers/customidp/callback?code=abc&state=${state}`,
      headers: { cookie },
    });
    expect(isLoginRedirect(res.headers.location as string)).toBe(true);
  });

  // ── A5-02: account-linking guard ──────────────────────────────────────────
  it("refuses to log into a pre-existing local account on an UNVERIFIED IdP email", async () => {
    // A pre-existing local (verified) account owns victim@corp.com.
    mockUserFindUnique.mockResolvedValue({
      id: "local-1",
      email: "victim@corp.com",
      username: "victim",
      firstName: "V",
      lastName: "T",
      image: null,
      emailVerified: true,
      isAdmin: false,
      tokenVersion: 0,
    });

    // We need the id_token nonce to match the flow. Read it from the authorize
    // redirect of a fresh flow whose cookie we keep.
    const flow = await startFlowWithNonce();
    stubFetch({
      discovery: discoveryDoc(),
      idToken: await signId({
        sub: "attacker-sub",
        email: "victim@corp.com",
        email_verified: false, // attacker IdP did NOT verify the email
        nonce: flow.nonce,
      }),
    });

    const res = await app.inject({
      method: "GET",
      url: `/auth/providers/customidp/callback?code=abc&state=${flow.state}`,
      headers: { cookie: flow.cookie },
    });

    // Must NOT issue a session cookie; redirect to the login error page.
    expect(res.statusCode).toBe(302);
    expect(isLoginRedirect(res.headers.location as string)).toBe(true);
    const setCookie = res.headers["set-cookie"];
    const raw = Array.isArray(setCookie) ? setCookie.join(";") : (setCookie ?? "");
    expect(raw).not.toMatch(/(^|;)\s*token=/);
    expect(mockUserAuthProviderCreate).not.toHaveBeenCalled();
  });

  it("logs in (creates a new user) for a verified email with a valid id_token", async () => {
    const flow = await startFlowWithNonce();
    stubFetch({
      discovery: discoveryDoc(),
      idToken: await signId({
        sub: "new-sub",
        email: "fresh@corp.com",
        email_verified: true,
        nonce: flow.nonce,
        name: "Fresh User",
      }),
    });

    const res = await app.inject({
      method: "GET",
      url: `/auth/providers/customidp/callback?code=abc&state=${flow.state}`,
      headers: { cookie: flow.cookie },
    });

    expect(res.statusCode).toBe(302);
    // Lands on the appUrl-based dashboard, not the login error page.
    expect(res.headers.location).toBe(`${APP_URL}/dashboard`);
    const setCookie = res.headers["set-cookie"];
    const raw = Array.isArray(setCookie) ? setCookie.join(";") : (setCookie ?? "");
    expect(raw).toMatch(/token=/);
    expect(mockUserCreate).toHaveBeenCalledTimes(1);
    expect(mockUserCreate.mock.calls[0][0].data.emailVerified).toBe(true);
  });

  // ── A5-05: SSRF guard on token/jwks host ──────────────────────────────────
  it("rejects when the OIDC token endpoint resolves to an internal host", async () => {
    const flow = await startFlowWithNonce();
    // Discovery points the token endpoint at the cloud metadata service.
    stubFetch({
      discovery: discoveryDoc({ token_endpoint: "http://169.254.169.254/token" }),
      tokenEndpoint: "http://169.254.169.254/token",
      idToken: await signId({ sub: "u", email: "a@b.com", nonce: flow.nonce }),
    });

    const res = await app.inject({
      method: "GET",
      url: `/auth/providers/customidp/callback?code=abc&state=${flow.state}`,
      headers: { cookie: flow.cookie },
    });
    expect(res.statusCode).toBe(302);
    expect(isLoginRedirect(res.headers.location as string)).toBe(true);
  });

  it("rejects when the JWKS endpoint resolves to a private host", async () => {
    const flow = await startFlowWithNonce();
    stubFetch({
      discovery: discoveryDoc({ jwks_uri: "http://127.0.0.1:9000/jwks" }),
      jwksUri: "http://127.0.0.1:9000/jwks",
      idToken: await signId({
        sub: "u",
        email: "a@b.com",
        email_verified: true,
        nonce: flow.nonce,
      }),
    });

    const res = await app.inject({
      method: "GET",
      url: `/auth/providers/customidp/callback?code=abc&state=${flow.state}`,
      headers: { cookie: flow.cookie },
    });
    expect(res.statusCode).toBe(302);
    expect(isLoginRedirect(res.headers.location as string)).toBe(true);
  });

  // Helper that returns the flow cookie, state, AND the nonce embedded in the
  // authorize redirect (needed so a hand-signed id_token passes the nonce check).
  async function startFlowWithNonce(): Promise<{
    cookie: string;
    state: string;
    nonce: string;
  }> {
    stubFetch({ discovery: discoveryDoc() });
    const res = await app.inject({
      method: "GET",
      url: "/auth/providers/customidp/authorize",
    });
    const location = new URL(res.headers.location as string);
    const state = location.searchParams.get("state") as string;
    const nonce = location.searchParams.get("nonce") as string;
    const setCookie = res.headers["set-cookie"];
    const raw = Array.isArray(setCookie) ? setCookie.join(";") : (setCookie ?? "");
    const m = raw.match(/oauth_flow=([^;]+)/);
    return { cookie: `oauth_flow=${m?.[1]}`, state, nonce };
  }
});
