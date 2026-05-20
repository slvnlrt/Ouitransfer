import type { FastifyRequest } from "fastify";
import { UnauthorizedError } from "../utils/app-error.js";

/**
 * Creates a preValidation hook that verifies the JWT token.
 * Throws 401 UnauthorizedError if the token is missing or invalid.
 */
export function createJwtPreValidation() {
  return async (request: FastifyRequest) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      request.log.warn({ err }, "JWT verification failed");
      throw new UnauthorizedError("Unauthorized: a valid token is required.");
    }
  };
}
