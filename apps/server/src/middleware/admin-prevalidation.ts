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

    // A2-08 (Info): `request.user.isAdmin` comes from the verified JWT claim, not
    // a per-request DB read. This is safe for authorization because every
    // privilege change increments `tokenVersion` and `validateTokenVersion`
    // (wired into jwtVerify) rejects stale tokens within its short cache TTL, and
    // `rotateRefreshToken` re-reads `isAdmin` from the DB on refresh — so a
    // demoted admin's token is invalidated, not merely stale. The only window is
    // a recently-PROMOTED user whose old token still says `isAdmin: false` until
    // refresh/re-login; that fails CLOSED (access denied), so it is not a risk.
    if (!request.user.isAdmin) {
      throw new ForbiddenError("Access restricted to administrators");
    }
  };
}
