/**
 * id-token.service.test.ts — OIDC id_token verification (A5-01).
 *
 * Generates a real RSA + EC key pair with `jose`, signs id_tokens locally, and
 * stubs the JWKS fetch with the public JWK so the full verification path
 * (signature, alg allowlist, iss/aud/exp, nonce) is exercised end-to-end.
 */

import * as jose from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  getLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

import { __clearJwksCacheForTest, verifyIdToken } from "../id-token.service.js";

const ISSUER = "https://idp.example.com";
const AUDIENCE = "client-abc";
const JWKS_URI = "https://idp.example.com/jwks";
const NONCE = "nonce-1234567890";

let rsaPrivate: jose.KeyLike;
let rsaPublicJwk: jose.JWK;
let rsaKid: string;

async function setupRsaKeys() {
  const { privateKey, publicKey } = await jose.generateKeyPair("RS256");
  rsaPrivate = privateKey;
  rsaKid = "rsa-key-1";
  rsaPublicJwk = { ...(await jose.exportJWK(publicKey)), kid: rsaKid, alg: "RS256", use: "sig" };
}

/** Stub global fetch so the JWKS endpoint returns our generated public key. */
function stubJwksFetch(keys: jose.JWK[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      const u = url.toString();
      if (u === JWKS_URI) {
        return new Response(JSON.stringify({ keys }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch: ${u}`);
    }),
  );
}

async function signIdToken(
  claims: Record<string, unknown>,
  opts: { alg?: string; kid?: string; key?: jose.KeyLike | Uint8Array } = {},
): Promise<string> {
  const alg = opts.alg ?? "RS256";
  return new jose.SignJWT(claims)
    .setProtectedHeader({ alg, kid: opts.kid ?? rsaKid })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime("5m")
    .sign(opts.key ?? rsaPrivate);
}

describe("verifyIdToken", () => {
  beforeEach(async () => {
    __clearJwksCacheForTest();
    await setupRsaKeys();
    stubJwksFetch([rsaPublicJwk]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts a valid RS256 id_token and returns sub/email/email_verified", async () => {
    const idToken = await signIdToken({
      sub: "user-1",
      email: "alice@example.com",
      email_verified: true,
      nonce: NONCE,
      name: "Alice",
    });

    const result = await verifyIdToken({
      idToken,
      issuer: ISSUER,
      audience: AUDIENCE,
      jwksUri: JWKS_URI,
      expectedNonce: NONCE,
    });

    expect(result.sub).toBe("user-1");
    expect(result.email).toBe("alice@example.com");
    expect(result.emailVerified).toBe(true);
  });

  it("treats string 'true' email_verified as verified", async () => {
    const idToken = await signIdToken({
      sub: "user-1",
      email: "alice@example.com",
      email_verified: "true",
      nonce: NONCE,
    });
    const result = await verifyIdToken({
      idToken,
      issuer: ISSUER,
      audience: AUDIENCE,
      jwksUri: JWKS_URI,
      expectedNonce: NONCE,
    });
    expect(result.emailVerified).toBe(true);
  });

  it("defaults email_verified to false when the claim is absent", async () => {
    const idToken = await signIdToken({ sub: "u", email: "a@b.com", nonce: NONCE });
    const result = await verifyIdToken({
      idToken,
      issuer: ISSUER,
      audience: AUDIENCE,
      jwksUri: JWKS_URI,
      expectedNonce: NONCE,
    });
    expect(result.emailVerified).toBe(false);
  });

  it("rejects a token whose nonce does not match the bound flow", async () => {
    const idToken = await signIdToken({
      sub: "u",
      email: "a@b.com",
      nonce: "different-nonce",
    });
    await expect(
      verifyIdToken({
        idToken,
        issuer: ISSUER,
        audience: AUDIENCE,
        jwksUri: JWKS_URI,
        expectedNonce: NONCE,
      }),
    ).rejects.toThrow(/nonce/i);
  });

  it("rejects a token with the wrong issuer", async () => {
    const idToken = await new jose.SignJWT({ sub: "u", email: "a@b.com", nonce: NONCE })
      .setProtectedHeader({ alg: "RS256", kid: rsaKid })
      .setIssuedAt()
      .setIssuer("https://evil.example")
      .setAudience(AUDIENCE)
      .setExpirationTime("5m")
      .sign(rsaPrivate);

    await expect(
      verifyIdToken({
        idToken,
        issuer: ISSUER,
        audience: AUDIENCE,
        jwksUri: JWKS_URI,
        expectedNonce: NONCE,
      }),
    ).rejects.toThrow(/verification failed/i);
  });

  it("rejects a token with the wrong audience", async () => {
    const idToken = await new jose.SignJWT({ sub: "u", email: "a@b.com", nonce: NONCE })
      .setProtectedHeader({ alg: "RS256", kid: rsaKid })
      .setIssuedAt()
      .setIssuer(ISSUER)
      .setAudience("some-other-client")
      .setExpirationTime("5m")
      .sign(rsaPrivate);

    await expect(
      verifyIdToken({
        idToken,
        issuer: ISSUER,
        audience: AUDIENCE,
        jwksUri: JWKS_URI,
        expectedNonce: NONCE,
      }),
    ).rejects.toThrow(/verification failed/i);
  });

  it("rejects an expired token", async () => {
    const idToken = await new jose.SignJWT({ sub: "u", email: "a@b.com", nonce: NONCE })
      .setProtectedHeader({ alg: "RS256", kid: rsaKid })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(rsaPrivate);

    await expect(
      verifyIdToken({
        idToken,
        issuer: ISSUER,
        audience: AUDIENCE,
        jwksUri: JWKS_URI,
        expectedNonce: NONCE,
      }),
    ).rejects.toThrow(/verification failed/i);
  });

  it("rejects an alg=none (unsigned) token — alg-confusion / none guard", async () => {
    // Hand-craft an alg:none JWT: header.payload. (empty signature)
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        sub: "u",
        email: "a@b.com",
        nonce: NONCE,
        iss: ISSUER,
        aud: AUDIENCE,
        exp: Math.floor(Date.now() / 1000) + 300,
      }),
    ).toString("base64url");
    const idToken = `${header}.${payload}.`;

    await expect(
      verifyIdToken({
        idToken,
        issuer: ISSUER,
        audience: AUDIENCE,
        jwksUri: JWKS_URI,
        expectedNonce: NONCE,
      }),
    ).rejects.toThrow(/verification failed/i);
  });

  it("rejects an HS256 token signed with the RSA public JWK (alg-confusion)", async () => {
    // Attacker uses the published public key bytes as an HMAC secret.
    const publicKeyPem = Buffer.from(JSON.stringify(rsaPublicJwk));
    const idToken = await new jose.SignJWT({ sub: "u", email: "a@b.com", nonce: NONCE })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setExpirationTime("5m")
      .sign(new Uint8Array(publicKeyPem));

    await expect(
      verifyIdToken({
        idToken,
        issuer: ISSUER,
        audience: AUDIENCE,
        jwksUri: JWKS_URI,
        expectedNonce: NONCE,
      }),
    ).rejects.toThrow(/verification failed/i);
  });

  it("rejects a token signed by an unrelated key (bad signature)", async () => {
    const { privateKey: otherKey } = await jose.generateKeyPair("RS256");
    const idToken = await new jose.SignJWT({ sub: "u", email: "a@b.com", nonce: NONCE })
      .setProtectedHeader({ alg: "RS256", kid: rsaKid })
      .setIssuedAt()
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setExpirationTime("5m")
      .sign(otherKey);

    await expect(
      verifyIdToken({
        idToken,
        issuer: ISSUER,
        audience: AUDIENCE,
        jwksUri: JWKS_URI,
        expectedNonce: NONCE,
      }),
    ).rejects.toThrow(/verification failed/i);
  });

  it("throws when no JWKS uri is configured", async () => {
    const idToken = await signIdToken({ sub: "u", email: "a@b.com", nonce: NONCE });
    await expect(
      verifyIdToken({
        idToken,
        issuer: ISSUER,
        audience: AUDIENCE,
        jwksUri: "",
        expectedNonce: NONCE,
      }),
    ).rejects.toThrow(/jwks/i);
  });

  it("normalizes a trailing slash on the issuer", async () => {
    const idToken = await signIdToken({ sub: "u", email: "a@b.com", nonce: NONCE });
    const result = await verifyIdToken({
      idToken,
      issuer: `${ISSUER}/`,
      audience: AUDIENCE,
      jwksUri: JWKS_URI,
      expectedNonce: NONCE,
    });
    expect(result.sub).toBe("u");
  });
});
