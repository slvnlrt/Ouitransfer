/**
 * @vitest-environment node
 *
 * Tests for CSP_STORAGE_ORIGINS validation (A7-04). The value is concatenated
 * into the page CSP img-src/connect-src, so it must be storage origin(s) only —
 * no wildcards, no CSP-injection metacharacters.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const VALID_SECRET = "a]#Fq9K!mZ3Tv&bW8xR2pL7jY0sN5dH6"; // 32+ chars

/**
 * Loads a fresh copy of the env module with CSP_STORAGE_ORIGINS set to `value`
 * and returns a function that triggers lazy validation by reading the property.
 */
async function readCspOrigins(value: string | undefined): Promise<() => unknown> {
  vi.resetModules();
  process.env.JWT_SECRET = VALID_SECRET;
  if (value === undefined) delete process.env.CSP_STORAGE_ORIGINS;
  else process.env.CSP_STORAGE_ORIGINS = value;
  const { env } = await import("@/env");
  return () => env.CSP_STORAGE_ORIGINS;
}

describe("env CSP_STORAGE_ORIGINS (A7-04)", () => {
  const original = process.env.CSP_STORAGE_ORIGINS;
  const originalSecret = process.env.JWT_SECRET;

  beforeEach(() => {
    delete process.env.API_BASE_URL;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.CSP_STORAGE_ORIGINS;
    else process.env.CSP_STORAGE_ORIGINS = original;
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  });

  it("accepts a single bare storage origin", async () => {
    const read = await readCspOrigins("http://storage:9000");
    expect(read()).toBe("http://storage:9000");
  });

  it("accepts multiple space-separated origins", async () => {
    const read = await readCspOrigins("http://storage:9000 https://cdn.example.com");
    expect(read()).toBe("http://storage:9000 https://cdn.example.com");
  });

  it("accepts an unset value", async () => {
    const read = await readCspOrigins(undefined);
    expect(read()).toBeUndefined();
  });

  it("rejects a wildcard origin (*)", async () => {
    const read = await readCspOrigins("*");
    expect(read).toThrow();
  });

  it("rejects a wildcard subdomain origin", async () => {
    const read = await readCspOrigins("https://*.example.com");
    expect(read).toThrow();
  });

  it("rejects a value with a CSP-injection separator", async () => {
    const read = await readCspOrigins("http://storage:9000; script-src 'unsafe-inline'");
    expect(read).toThrow();
  });

  it("rejects an origin with a path", async () => {
    const read = await readCspOrigins("https://cdn.example.com/path");
    expect(read).toThrow();
  });
});
