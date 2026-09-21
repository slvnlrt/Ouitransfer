import { describe, expect, it } from "vitest";
import { parseTrustProxy } from "../parse-trust-proxy.js";

describe("parseTrustProxy", () => {
  it('returns boolean true for "true"', () => {
    expect(parseTrustProxy("true")).toBe(true);
  });

  it('returns boolean false for "false"', () => {
    expect(parseTrustProxy("false")).toBe(false);
  });

  it("fails closed for a numeric hop count", () => {
    expect(parseTrustProxy("1")).toBe(false);
    expect(parseTrustProxy("0")).toBe(false);
    expect(parseTrustProxy("3")).toBe(false);
  });

  it("returns a string for Fastify keyword values", () => {
    expect(parseTrustProxy("loopback")).toBe("loopback");
    expect(parseTrustProxy("linklocal")).toBe("linklocal");
    expect(parseTrustProxy("uniquelocal")).toBe("uniquelocal");
  });

  it("returns a string for a single CIDR", () => {
    expect(parseTrustProxy("10.0.0.0/8")).toBe("10.0.0.0/8");
  });

  it("returns a trimmed string array for a comma-separated list", () => {
    expect(parseTrustProxy("10.0.0.0/8, 172.16.0.0/12")).toEqual(["10.0.0.0/8", "172.16.0.0/12"]);
  });

  it("returns a string array for comma-separated Fastify keywords", () => {
    expect(parseTrustProxy("loopback, uniquelocal")).toEqual(["loopback", "uniquelocal"]);
  });
});
