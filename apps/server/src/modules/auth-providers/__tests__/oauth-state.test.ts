/**
 * oauth-state.test.ts — browser-bound, single-use OAuth flow state (A5-03 / A5-09).
 *
 * Uses a minimal Fastify instance with @fastify/cookie so set/consume run through
 * the real cookie machinery.
 */

import fastifyCookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  consumeOAuthFlowCookie,
  OAUTH_STATE_COOKIE_NAME,
  type OAuthFlowState,
  setOAuthFlowCookie,
} from "../oauth-state.js";

const SAMPLE: OAuthFlowState = {
  providerName: "google",
  state: "server-generated-state-0001",
  nonce: "server-generated-nonce-0001",
  codeVerifier: "pkce-verifier-abc",
  returnPath: "/dashboard",
};

/** Boot a tiny app exposing set + consume so we can round-trip the cookie. */
async function buildHarness(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(fastifyCookie, { secret: "x".repeat(40) });

  app.get("/set", async (_req, reply) => {
    await setOAuthFlowCookie(reply, SAMPLE);
    return reply.send({ ok: true });
  });

  // Echoes the consumed state, or the error message.
  app.get<{ Querystring: { provider?: string; state?: string } }>(
    "/consume",
    async (req, reply) => {
      try {
        const consumed = await consumeOAuthFlowCookie(req, reply, {
          providerName: req.query.provider ?? "google",
          state: req.query.state ?? SAMPLE.state,
        });
        return reply.send({ ok: true, consumed });
      } catch (err) {
        return reply.status(401).send({ ok: false, message: (err as Error).message });
      }
    },
  );

  await app.ready();
  return app;
}

describe("OAuth flow state cookie", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildHarness();
  });

  afterAll(async () => {
    await app.close();
  });

  function extractCookie(setCookie: string | string[] | undefined): string {
    const raw = Array.isArray(setCookie) ? setCookie.join(";") : (setCookie ?? "");
    const match = raw.match(new RegExp(`${OAUTH_STATE_COOKIE_NAME}=([^;]+)`));
    return match ? `${OAUTH_STATE_COOKIE_NAME}=${match[1]}` : "";
  }

  it("round-trips a valid flow and binds it to the browser cookie", async () => {
    const setRes = await app.inject({ method: "GET", url: "/set" });
    const cookie = extractCookie(setRes.headers["set-cookie"]);
    expect(cookie).toContain(OAUTH_STATE_COOKIE_NAME);

    const consumeRes = await app.inject({
      method: "GET",
      url: `/consume?provider=google&state=${SAMPLE.state}`,
      headers: { cookie },
    });
    expect(consumeRes.statusCode).toBe(200);
    const body = consumeRes.json<{ consumed: OAuthFlowState }>();
    expect(body.consumed.nonce).toBe(SAMPLE.nonce);
    expect(body.consumed.codeVerifier).toBe(SAMPLE.codeVerifier);
    expect(body.consumed.returnPath).toBe("/dashboard");
  });

  it("rejects when no cookie is present (A5-03 browser binding)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/consume?provider=google&state=${SAMPLE.state}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a mismatched state (login CSRF / forced-login defence)", async () => {
    const setRes = await app.inject({ method: "GET", url: "/set" });
    const cookie = extractCookie(setRes.headers["set-cookie"]);

    const res = await app.inject({
      method: "GET",
      url: "/consume?provider=google&state=attacker-chosen-state",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects when the provider does not match the cookie", async () => {
    const setRes = await app.inject({ method: "GET", url: "/set" });
    const cookie = extractCookie(setRes.headers["set-cookie"]);

    const res = await app.inject({
      method: "GET",
      url: `/consume?provider=github&state=${SAMPLE.state}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(401);
  });

  it("is strictly single-use — consume clears the cookie", async () => {
    const setRes = await app.inject({ method: "GET", url: "/set" });
    const cookie = extractCookie(setRes.headers["set-cookie"]);

    const first = await app.inject({
      method: "GET",
      url: `/consume?provider=google&state=${SAMPLE.state}`,
      headers: { cookie },
    });
    expect(first.statusCode).toBe(200);
    // The consume response must clear the cookie so a replay of the SAME cookie
    // (browser would have dropped it) is meaningless; verify a clearing header.
    const cleared = Array.isArray(first.headers["set-cookie"])
      ? first.headers["set-cookie"].join(";")
      : (first.headers["set-cookie"] ?? "");
    expect(cleared).toContain(OAUTH_STATE_COOKIE_NAME);
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/i);
  });

  it("rejects a tampered cookie value", async () => {
    const setRes = await app.inject({ method: "GET", url: "/set" });
    const cookie = extractCookie(setRes.headers["set-cookie"]);
    // Corrupt the JWT payload segment (between the two dots) so the HMAC no
    // longer matches.
    const [name, value] = cookie.split("=");
    const [h, p, s] = value.split(".");
    const corruptedPayload = `${p.slice(0, -2)}XX`;
    const tampered = `${name}=${h}.${corruptedPayload}.${s}`;

    const res = await app.inject({
      method: "GET",
      url: `/consume?provider=google&state=${SAMPLE.state}`,
      headers: { cookie: tampered },
    });
    expect(res.statusCode).toBe(401);
  });
});
