import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
import { ErrorCodes } from "@ouitransfer/shared/error-codes";
import { z } from "zod";

import { createJwtPreValidation } from "../../middleware/jwt-prevalidation.js";
import { prisma } from "../../shared/prisma.js";
import { AppError, UnauthorizedError } from "../../utils/app-error.js";
import { getClientInfo } from "../../utils/auth-cookies.js";
import { ErrorResponseSchema } from "../../utils/error-response-schema.js";
import { getLogger } from "../../utils/logger.js";
import { logAuditEvent } from "../audit/service.js";
import { is2faVerifyLocked, recordLoginAttempt } from "../auth/login-attempts.service.js";
import { getConfigValue } from "../config/service.js";
import { TwoFactorService } from "./service.js";

const twoFactorService = new TwoFactorService();

const preValidation = createJwtPreValidation();

export const twoFactorRoutes: FastifyPluginAsyncZod = async (app) => {
  app.route({
    method: "POST",
    url: "/2fa/setup",
    preValidation,
    schema: {
      tags: ["Two-Factor Authentication"],
      operationId: "generate2FASetup",
      summary: "Generate 2FA Setup",
      description: "Generate QR code and secret for 2FA setup",
      body: z.object({
        appName: z.string().optional().describe("Application name for QR code"),
      }),
      response: {
        200: z.object({
          secret: z.string().describe("Base32 encoded secret"),
          qrCode: z.string().describe("QR code as data URL"),
          manualEntryKey: z.string().describe("Manual entry key"),
          backupCodes: z
            .array(
              z.object({
                code: z.string().describe("Backup code"),
                used: z.boolean().describe("Whether backup code is used"),
              }),
            )
            .describe("Backup codes"),
        }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError();
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });

      if (!user) {
        throw new UnauthorizedError();
      }

      const appName = request.body.appName || (await getConfigValue("appName")) || "OUITRANSFER";

      const setupData = await twoFactorService.generateSetup(userId, user.email, appName);

      return reply.send(setupData);
    },
  });

  app.route({
    method: "POST",
    url: "/2fa/verify-setup",
    preValidation,
    schema: {
      tags: ["Two-Factor Authentication"],
      operationId: "verify2FASetup",
      summary: "Verify 2FA Setup",
      description: "Verify the setup token and enable 2FA",
      body: z.object({
        token: z.string().trim().min(6).describe("TOTP token"),
        secret: z.string().min(1).describe("Base32 encoded secret"),
        password: z.string().min(1).describe("Current account password (re-authentication)"),
      }),
      response: {
        200: z.object({
          success: z.boolean().describe("Setup success"),
          backupCodes: z.array(z.string()).describe("Backup codes"),
        }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError();
      }

      const result = await twoFactorService.verifySetup(
        userId,
        request.body.token,
        request.body.secret,
        request.body.password,
      );

      // Audit 2FA enable (fire-and-forget)
      logAuditEvent({
        userId,
        action: "TWO_FACTOR_ENABLE",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        targetType: "user",
        targetId: userId,
      }).catch((err) => getLogger().error({ err }, "Audit log write failed"));

      return reply.send(result);
    },
  });

  app.route({
    method: "POST",
    url: "/2fa/verify",
    preValidation,
    config: {
      rateLimit: {
        max: 5,
        timeWindow: "1 minute",
      },
    },
    schema: {
      tags: ["Two-Factor Authentication"],
      operationId: "verify2FAToken",
      summary: "Verify 2FA Token",
      description: "Verify a 2FA token during authentication",
      body: z.object({
        token: z.string().trim().min(6).describe("TOTP token or backup code"),
      }),
      response: {
        200: z.object({
          success: z.boolean().describe("Verification success"),
          method: z.enum(["totp", "backup"]).describe("Verification method used"),
        }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError();
      }

      // Resolve the email to key the lockout on (A1-02).
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });
      if (!user) {
        throw new UnauthorizedError();
      }

      const { ipAddress, userAgent } = getClientInfo(request);

      // Dedicated low-threshold 2FA lockout pre-check — brakes online TOTP /
      // backup-code brute force on the standalone step-up endpoint.
      const lockStatus = await is2faVerifyLocked(user.email, ipAddress || "unknown");
      if (lockStatus.locked) {
        logAuditEvent({
          userId,
          action: "TWO_FACTOR_VERIFY_LOCKED",
          ipAddress,
          userAgent,
          targetType: "user",
          targetId: userId,
        }).catch((err) => getLogger().error({ err }, "Audit log write failed"));
        throw new AppError(
          403,
          `Too many failed verification attempts. Try again in ${lockStatus.remainingMinutes} minutes.`,
          ErrorCodes.ACCOUNT_LOCKED,
          { remainingMinutes: lockStatus.remainingMinutes },
        );
      }

      let result: Awaited<ReturnType<TwoFactorService["verifyToken"]>>;
      try {
        result = await twoFactorService.verifyToken(userId, request.body.token);
      } catch (err) {
        // Count the failure toward the lockout and audit it.
        await recordLoginAttempt(user.email, ipAddress || "unknown", false);
        logAuditEvent({
          userId,
          action: "TWO_FACTOR_VERIFY_FAILURE",
          ipAddress,
          userAgent,
          targetType: "user",
          targetId: userId,
        }).catch((auditErr) => getLogger().error({ err: auditErr }, "Audit log write failed"));
        throw err;
      }

      // Success resets the failure counter.
      await recordLoginAttempt(user.email, ipAddress || "unknown", true);

      return reply.send({ success: result.success, method: result.method });
    },
  });

  app.route({
    method: "POST",
    url: "/2fa/disable",
    preValidation,
    schema: {
      tags: ["Two-Factor Authentication"],
      operationId: "disable2FA",
      summary: "Disable 2FA",
      description: "Disable two-factor authentication",
      body: z.object({
        password: z.string().min(1).describe("User password for confirmation"),
        totpCode: z.string().trim().min(6).describe("TOTP verification code or backup code"),
      }),
      response: {
        200: z.object({
          success: z.boolean().describe("Disable success"),
        }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError();
      }

      const result = await twoFactorService.disable2FA(
        userId,
        request.body.password,
        request.body.totpCode,
      );

      // Audit 2FA disable (fire-and-forget)
      logAuditEvent({
        userId,
        action: "TWO_FACTOR_DISABLE",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        targetType: "user",
        targetId: userId,
      }).catch((err) => getLogger().error({ err }, "Audit log write failed"));

      return reply.send(result);
    },
  });

  app.route({
    method: "POST",
    url: "/2fa/backup-codes",
    preValidation,
    schema: {
      tags: ["Two-Factor Authentication"],
      operationId: "generateBackupCodes",
      summary: "Generate Backup Codes",
      description: "Generate new backup codes for 2FA (requires re-authentication)",
      body: z.object({
        password: z.string().min(1).describe("Current account password (re-authentication)"),
        totpCode: z
          .string()
          .trim()
          .min(6)
          .describe("Current TOTP verification code or backup code (step-up)"),
      }),
      response: {
        200: z.object({
          backupCodes: z.array(z.string()).describe("New backup codes"),
        }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError();
      }

      const codes = await twoFactorService.generateNewBackupCodes(
        userId,
        request.body.password,
        request.body.totpCode,
      );

      // Audit backup codes regeneration (fire-and-forget)
      logAuditEvent({
        userId,
        action: "TWO_FACTOR_BACKUP_REGENERATED",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        targetType: "user",
        targetId: userId,
      }).catch((err) => getLogger().error({ err }, "Audit log write failed"));

      return reply.send({ backupCodes: codes });
    },
  });

  app.route({
    method: "GET",
    url: "/2fa/status",
    preValidation,
    schema: {
      tags: ["Two-Factor Authentication"],
      operationId: "get2FAStatus",
      summary: "Get 2FA Status",
      description: "Get current 2FA status for the user",
      response: {
        200: z.object({
          enabled: z.boolean().describe("Whether 2FA is enabled"),
          verified: z.boolean().describe("Whether 2FA is verified"),
          availableBackupCodes: z.number().describe("Number of available backup codes"),
        }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError();
      }

      const status = await twoFactorService.getStatus(userId);

      return reply.send(status);
    },
  });
};
