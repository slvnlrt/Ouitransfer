import type { FastifyRequest } from "fastify";

import { assertPasswordPolicy } from "../auth/password-policy.js";

/**
 * Enforce the full password policy (min length, max bytes, complexity) on any
 * route body that carries a `password`. Delegates to {@link assertPasswordPolicy}
 * so the middleware and the Zod route schemas share one source of truth.
 */
export async function validatePasswordMiddleware(request: FastifyRequest) {
  const body = request.body as { password?: string };
  if (!body.password) return;

  await assertPasswordPolicy(body.password);
}
