import { fastify } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { healthRoutes } from "../modules/health/routes.js";

describe("Health endpoint", () => {
  const app = fastify({ logger: false });

  beforeAll(async () => {
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.register(healthRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /health returns 200 with healthy status", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);

    const body = response.json<{ status: string; timestamp: string }>();
    expect(body.status).toBe("healthy");
    expect(typeof body.timestamp).toBe("string");
  });
});
