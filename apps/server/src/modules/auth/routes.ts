import { ErrorCodes } from "@ouitransfer/shared/error-codes";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { REFRESH_TOKEN_COOKIE_NAME } from "../../config/auth.config.js";
import { createJwtPreValidation } from "../../middleware/jwt-prevalidation.js";
import { AppError, UnauthorizedError } from "../../utils/app-error.js";
import {
  clearAuthCookies,
  getClientInfo,
  setAuthCookies,
  signAndSetCookies,
} from "../../utils/auth-cookies.js";
import { ErrorResponseSchema } from "../../utils/error-response-schema.js";
import { getLogger } from "../../utils/logger.js";
import { logAuditEvent } from "../audit/service.js";
import { getConfigValue } from "../config/service.js";
import { validatePasswordMiddleware } from "../user/middleware.js";
import { createChallengeToken, verifyChallengeToken } from "./challenge.js";
import {
  CompleteTwoFactorLoginSchema,
  createResetPasswordSchema,
  RequestPasswordResetSchema,
} from "./dto.js";
import { revokeAllUserTokens, rotateRefreshToken } from "./refresh-token.service.js";
import { AuthService } from "./service.js";

/** Body size limit for auth endpoints — payloads are small JSON only. */
const AUTH_BODY_LIMIT = 64 * 1024; // 64 KB

const authService = new AuthService();

const createPasswordSchema = async () => {
  const minLength = Number(await getConfigValue("passwordMinLength"));
  return z
    .string()
    .min(minLength, `Password must be at least ${minLength} characters`)
    .describe("User password");
};

const jwtPreValidation = createJwtPreValidation();

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  const passwordSchema = await createPasswordSchema();
  const loginSchema = z.object({
    emailOrUsername: z
      .string()
      .min(1, "Email or username is required")
      .describe("User email or username"),
    password: passwordSchema,
  });

  // ── POST /auth/login ──────────────────────────────────────────
  app.route({
    method: "POST",
    url: "/auth/login",
    bodyLimit: AUTH_BODY_LIMIT,
    config: {
      csrfExempt: true,
      rateLimit: {
        max: 5,
        timeWindow: "1 minute",
      },
    },
    schema: {
      tags: ["Authentication"],
      operationId: "login",
      summary: "Login",
      description: "Performs login and returns user data",
      body: loginSchema,
      response: {
        200: z.union([
          z.object({
            user: z.object({
              id: z.string().describe("User ID"),
              firstName: z.string().describe("User first name"),
              lastName: z.string().describe("User last name"),
              username: z.string().describe("User username"),
              email: z.string().email().describe("User email"),
              isAdmin: z.boolean().describe("User is admin"),
              isActive: z.boolean().describe("User is active"),
              createdAt: z.date().describe("User creation date"),
              updatedAt: z.date().describe("User last update date"),
            }),
          }),
          z.object({
            requiresTwoFactor: z.boolean().describe("Whether 2FA is required"),
            challengeToken: z.string().describe("Opaque challenge token for 2FA verification"),
            message: z.string().describe("2FA required message"),
          }),
        ]),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const input = request.body;
      const { userAgent, ipAddress } = getClientInfo(request);

      let result: Awaited<ReturnType<AuthService["login"]>>;
      try {
        result = await authService.login(input, userAgent, ipAddress);
      } catch (err) {
        // Audit failed login (fire-and-forget)
        // Use LOGIN_LOCKED for rate-limit lockouts to distinguish from credential failures
        const isLockout = err instanceof AppError && err.code === ErrorCodes.ACCOUNT_LOCKED;
        logAuditEvent({
          action: isLockout ? "LOGIN_LOCKED" : "LOGIN_FAILURE",
          ipAddress,
          userAgent,
          targetType: "user",
          metadata: { emailOrUsername: input.emailOrUsername },
        }).catch((auditErr) => getLogger().error({ err: auditErr }, "Audit log write failed"));
        throw err;
      }

      if ("requiresTwoFactor" in result) {
        const challengeToken = await createChallengeToken(result.userId);
        return reply.send({
          requiresTwoFactor: true,
          challengeToken,
          message: result.message,
        });
      }

      const user = result;
      await signAndSetCookies(reply, user, userAgent, ipAddress);

      // Audit successful login (fire-and-forget)
      logAuditEvent({
        userId: user.id,
        action: "LOGIN_SUCCESS",
        ipAddress,
        userAgent,
        targetType: "user",
        targetId: user.id,
        metadata: { method: "password" },
      }).catch((auditErr) => getLogger().error({ err: auditErr }, "Audit log write failed"));

      return reply.send({ user });
    },
  });

  // ── POST /auth/2fa/login ──────────────────────────────────────
  app.route({
    method: "POST",
    url: "/auth/2fa/login",
    bodyLimit: AUTH_BODY_LIMIT,
    config: {
      csrfExempt: true,
      rateLimit: {
        max: 5,
        timeWindow: "1 minute",
      },
    },
    schema: {
      tags: ["Authentication"],
      operationId: "completeTwoFactorLogin",
      summary: "Complete Two-Factor Login",
      description: "Complete login process with 2FA verification",
      body: CompleteTwoFactorLoginSchema,
      response: {
        200: z.object({
          user: z.object({
            id: z.string().describe("User ID"),
            firstName: z.string().describe("User first name"),
            lastName: z.string().describe("User last name"),
            username: z.string().describe("User username"),
            email: z.string().email().describe("User email"),
            isAdmin: z.boolean().describe("User is admin"),
            isActive: z.boolean().describe("User is active"),
            createdAt: z.date().describe("User creation date"),
            updatedAt: z.date().describe("User last update date"),
          }),
        }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const input = request.body;

      // Verify the challenge token instead of trusting a raw userId
      const userId = await verifyChallengeToken(input.challengeToken);

      const { userAgent, ipAddress } = getClientInfo(request);

      let user: Awaited<ReturnType<AuthService["completeTwoFactorLogin"]>>;
      try {
        user = await authService.completeTwoFactorLogin(
          userId,
          input.token,
          input.rememberDevice,
          userAgent,
          ipAddress,
        );
      } catch (err) {
        // Audit failed 2FA attempt (fire-and-forget)
        const isLockout = err instanceof AppError && err.code === ErrorCodes.ACCOUNT_LOCKED;
        logAuditEvent({
          userId,
          action: isLockout ? "LOGIN_LOCKED" : "LOGIN_FAILURE",
          ipAddress,
          userAgent,
          targetType: "user",
          targetId: userId,
          metadata: { method: "2fa" },
        }).catch((auditErr) => getLogger().error({ err: auditErr }, "Audit log write failed"));
        throw err;
      }

      await signAndSetCookies(reply, user, userAgent, ipAddress);

      // Audit successful 2FA login (fire-and-forget)
      logAuditEvent({
        userId: user.id,
        action: "LOGIN_SUCCESS",
        ipAddress,
        userAgent,
        targetType: "user",
        targetId: user.id,
        metadata: { method: "2fa" },
      }).catch((auditErr) => getLogger().error({ err: auditErr }, "Audit log write failed"));

      return reply.send({ user });
    },
  });

  // ── POST /auth/logout ─────────────────────────────────────────
  app.route({
    method: "POST",
    url: "/auth/logout",
    bodyLimit: AUTH_BODY_LIMIT,
    schema: {
      tags: ["Authentication"],
      operationId: "logout",
      summary: "Logout",
      description: "Performs logout by clearing the token cookie",
      response: {
        200: z.object({ message: z.string().describe("Logout message") }),
      },
    },
    handler: async (request, reply) => {
      const { userAgent, ipAddress } = getClientInfo(request);

      // Try to get userId from JWT for audit logging (may fail if token expired)
      let userId: string | undefined;
      try {
        await request.jwtVerify();
        userId = request.user?.userId;
      } catch {
        // Token may be expired or invalid — still proceed with logout
      }

      clearAuthCookies(reply);

      // Revoke all refresh tokens for this user so stolen tokens cannot be reused
      if (userId) {
        revokeAllUserTokens(userId).catch((err) =>
          getLogger().error({ err }, "Failed to revoke refresh tokens on logout"),
        );
      }

      // Audit logout (fire-and-forget)
      logAuditEvent({
        userId,
        action: "LOGOUT",
        ipAddress,
        userAgent,
        targetType: "user",
        targetId: userId,
      }).catch((auditErr) => getLogger().error({ err: auditErr }, "Audit log write failed"));

      return reply.send({ message: "Logout successful" });
    },
  });

  // ── POST /auth/forgot-password ────────────────────────────────
  app.route({
    method: "POST",
    url: "/auth/forgot-password",
    bodyLimit: AUTH_BODY_LIMIT,
    config: {
      csrfExempt: true,
      rateLimit: {
        max: 3,
        timeWindow: "1 minute",
      },
    },
    schema: {
      tags: ["Authentication"],
      operationId: "requestPasswordReset",
      summary: "Request Password Reset",
      description: "Request password reset email",
      body: RequestPasswordResetSchema,
      response: {
        200: z.object({
          message: z.string().describe("Reset password email sent"),
        }),
        400: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { email } = request.body;
      await authService.requestPasswordReset(email);

      // Audit password reset request (fire-and-forget)
      // No userId — intentionally omitted to avoid confirming user existence
      logAuditEvent({
        action: "PASSWORD_RESET_REQUEST",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        metadata: { email: request.body.email },
      }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));

      return reply.send({
        message: "If an account exists with this email, a password reset link will be sent.",
      });
    },
  });

  // ── POST /auth/reset-password ─────────────────────────────────
  app.route({
    method: "POST",
    url: "/auth/reset-password",
    bodyLimit: AUTH_BODY_LIMIT,
    config: {
      csrfExempt: true,
      rateLimit: {
        max: 3,
        timeWindow: "1 minute",
      },
    },
    preValidation: validatePasswordMiddleware,
    schema: {
      tags: ["Authentication"],
      operationId: "resetPassword",
      summary: "Reset Password",
      description: "Reset password using token",
      body: await createResetPasswordSchema(),
      response: {
        200: z.object({
          message: z.string().describe("Reset password message"),
        }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { token, password } = request.body;
      const { userAgent, ipAddress } = getClientInfo(request);

      const { userId } = await authService.resetPassword(token, password);

      // Audit password reset (fire-and-forget)
      logAuditEvent({
        userId,
        action: "PASSWORD_RESET",
        ipAddress,
        userAgent,
        targetType: "user",
        targetId: userId,
      }).catch((auditErr) => getLogger().error({ err: auditErr }, "Audit log write failed"));

      return reply.send({ message: "Password reset successfully" });
    },
  });

  // ── GET /auth/me ──────────────────────────────────────────────
  app.route({
    method: "GET",
    url: "/auth/me",
    schema: {
      tags: ["Authentication"],
      operationId: "getCurrentUser",
      summary: "Get Current User",
      description:
        "Returns the current authenticated user's information or null if not authenticated",
      response: {
        200: z.union([
          z.object({
            user: z.object({
              id: z.string().describe("User ID"),
              firstName: z.string().describe("User first name"),
              lastName: z.string().describe("User last name"),
              username: z.string().describe("User username"),
              email: z.string().email().describe("User email"),
              image: z.string().nullable().describe("User profile image URL"),
              isAdmin: z.boolean().describe("User is admin"),
              isActive: z.boolean().describe("User is active"),
              createdAt: z.date().describe("User creation date"),
              updatedAt: z.date().describe("User last update date"),
            }),
          }),
          z.object({
            user: z.null().describe("No user when not authenticated"),
          }),
        ]),
      },
    },
    handler: async (request, reply) => {
      let userId: string | null = null;
      try {
        await request.jwtVerify();
        userId = request.user?.userId;
      } catch {
        // Not authenticated — return null user (this is expected behavior, not an error)
        return reply.send({ user: null });
      }

      if (!userId) {
        return reply.send({ user: null });
      }

      const user = await authService.getUserById(userId);
      if (!user) {
        return reply.send({ user: null });
      }

      return reply.send({ user });
    },
  });

  // ── GET /auth/trusted-devices ─────────────────────────────────
  app.route({
    method: "GET",
    url: "/auth/trusted-devices",
    preValidation: jwtPreValidation,
    schema: {
      tags: ["Authentication"],
      operationId: "getTrustedDevices",
      summary: "Get Trusted Devices",
      description: "Get all trusted devices for the current user",
      response: {
        200: z.object({
          devices: z.array(
            z.object({
              id: z.string().describe("Device ID"),
              deviceName: z.string().nullable().describe("Device name"),
              userAgent: z.string().nullable().describe("User agent"),
              ipAddress: z.string().nullable().describe("IP address"),
              createdAt: z.date().describe("Creation date"),
              lastUsedAt: z.date().describe("Last used date"),
              expiresAt: z.date().describe("Expiration date"),
            }),
          ),
        }),
        401: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError(
          "Unauthorized: a valid token is required to access this resource.",
        );
      }

      const devices = await authService.getTrustedDevices(userId);
      return reply.send({ devices });
    },
  });

  // ── DELETE /auth/trusted-devices/:id ──────────────────────────
  app.route({
    method: "DELETE",
    url: "/auth/trusted-devices/:id",
    preValidation: jwtPreValidation,
    schema: {
      tags: ["Authentication"],
      operationId: "removeTrustedDevice",
      summary: "Remove Trusted Device",
      description: "Remove a specific trusted device",
      params: z.object({
        id: z.string().describe("Device ID"),
      }),
      response: {
        200: z.object({
          success: z.boolean().describe("Success status"),
          message: z.string().describe("Success message"),
        }),
        401: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError(
          "Unauthorized: a valid token is required to access this resource.",
        );
      }

      await authService.removeTrustedDevice(userId, request.params.id);

      // Audit trusted device removal (fire-and-forget)
      logAuditEvent({
        action: "TRUSTED_DEVICE_REMOVE",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        userId,
        targetType: "trusted_device",
        targetId: request.params.id,
      }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));

      return reply.send({ success: true, message: "Trusted device removed successfully" });
    },
  });

  // ── DELETE /auth/trusted-devices ──────────────────────────────
  app.route({
    method: "DELETE",
    url: "/auth/trusted-devices",
    preValidation: jwtPreValidation,
    schema: {
      tags: ["Authentication"],
      operationId: "removeAllTrustedDevices",
      summary: "Remove All Trusted Devices",
      description: "Remove all trusted devices for the current user",
      response: {
        200: z.object({
          success: z.boolean().describe("Success status"),
          message: z.string().describe("Success message"),
          removedCount: z.number().describe("Number of devices removed"),
        }),
        401: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError(
          "Unauthorized: a valid token is required to access this resource.",
        );
      }

      const result = await authService.removeAllTrustedDevices(userId);

      // Audit remove all trusted devices (fire-and-forget)
      logAuditEvent({
        action: "TRUSTED_DEVICE_REMOVE_ALL",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        userId,
        targetType: "user",
        targetId: userId,
        metadata: { count: result.removedCount },
      }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));

      return reply.send(result);
    },
  });

  // ── GET /auth/config ──────────────────────────────────────────
  app.route({
    method: "GET",
    url: "/auth/config",
    schema: {
      tags: ["Authentication"],
      operationId: "getAuthConfig",
      summary: "Get Authentication Configuration",
      description: "Get authentication configuration settings",
      response: {
        200: z.object({
          passwordAuthEnabled: z.boolean().describe("Whether password authentication is enabled"),
        }),
        400: ErrorResponseSchema,
      },
    },
    handler: async (_request, reply) => {
      const passwordAuthEnabled = await getConfigValue("passwordAuthEnabled");
      return reply.send({
        passwordAuthEnabled: passwordAuthEnabled === "true",
      });
    },
  });

  // ── POST /auth/refresh ────────────────────────────────────────
  // Public unauthenticated endpoint — the refresh token IS the auth.
  // CSRF-exempt (added to CSRF_EXEMPT_ROUTES in app.ts).
  app.route({
    method: "POST",
    url: "/auth/refresh",
    bodyLimit: AUTH_BODY_LIMIT,
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    schema: {
      tags: ["Authentication"],
      operationId: "refreshToken",
      summary: "Refresh Access Token",
      description:
        "Exchange a valid refresh token (sent via httpOnly cookie) for a new access token + refresh token pair (rotation).",
      response: {
        200: z.object({
          message: z.string().describe("Success message"),
        }),
        401: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      // Refresh token is always in the httpOnly cookie (unified approach for password + OIDC login)
      const refreshToken = (request.cookies as Record<string, string>)[REFRESH_TOKEN_COOKIE_NAME];

      if (!refreshToken) {
        throw new UnauthorizedError("Missing refresh token");
      }

      const result = await rotateRefreshToken(refreshToken);

      // Issue new short-lived access token as cookie
      const accessToken = await reply.jwtSign({
        userId: result.userId,
        isAdmin: result.isAdmin,
        tokenVersion: result.tokenVersion,
      });

      setAuthCookies(reply, { accessToken, refreshToken: result.refreshToken });

      return reply.send({ message: "Token refreshed" });
    },
  });
};
