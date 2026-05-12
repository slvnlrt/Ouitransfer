import type { FastifyRequest } from "fastify";

import { prisma } from "../shared/prisma.js";
import { ForbiddenError, UnauthorizedError } from "../utils/app-error.js";

/**
 * Creates a preValidation hook that enforces admin-only access.
 *
 * @param options.allowSetupBypass - When true, skips auth if zero users exist
 *   (initial setup window). When false, always requires a valid admin JWT.
 */
export function createAdminPreValidation(options: { allowSetupBypass: boolean }) {
  return async (request: FastifyRequest) => {
    if (options.allowSetupBypass) {
      const usersCount = await prisma.user.count();
      if (usersCount === 0) return; // Setup window only
    }

    try {
      await request.jwtVerify();
    } catch (err) {
      request.log.warn({ err }, "Admin JWT verification failed");
      throw new UnauthorizedError("Unauthorized: a valid token is required.");
    }

    if (!request.user.isAdmin) {
      throw new ForbiddenError("Access restricted to administrators");
    }
  };
}
