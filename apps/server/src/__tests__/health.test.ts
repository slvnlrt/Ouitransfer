import { describe, expect, it } from "vitest";

describe("Server smoke test", () => {
  it("should have NODE_ENV defined or default to test", () => {
    const env = process.env.NODE_ENV ?? "test";
    expect(env).toBeTruthy();
  });

  it("should be able to import fastify", async () => {
    const { default: Fastify } = await import("fastify");
    expect(Fastify).toBeDefined();
    expect(typeof Fastify).toBe("function");
  });
});
