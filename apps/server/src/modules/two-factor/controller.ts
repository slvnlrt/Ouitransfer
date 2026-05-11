import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { prisma } from "../../shared/prisma.js";
import { NotFoundError, UnauthorizedError } from "../../utils/app-error.js";
import { getLogger } from "../../utils/logger.js";
import { logAuditEvent } from "../audit/service.js";
import { ConfigService } from "../config/service.js";
import { TwoFactorService } from "./service.js";

const SetupSchema = z
  .object({
    appName: z.string().optional(),
  })
  .optional()
  .default({});

const VerifySetupSchema = z.object({
  token: z.string().trim().min(6, "Token must be at least 6 characters"),
  secret: z.string().min(1, "Secret is required"),
});

const VerifyTokenSchema = z.object({
  token: z.string().trim().min(6, "Token must be at least 6 characters"),
});

const DisableSchema = z.object({
  password: z.string().min(1, "Password is required"),
  totpCode: z
    .string()
    .trim()
    .min(6, "Verification code must be at least 6 characters")
    .describe("TOTP code or backup code"),
});

export class TwoFactorController {
  private twoFactorService = new TwoFactorService();
  private configService = new ConfigService();

  /**
   * Generate 2FA setup (QR code and secret)
   */
  async generateSetup(request: FastifyRequest, reply: FastifyReply) {
    const userId = request.user?.userId;
    if (!userId) {
      throw new UnauthorizedError();
    }

    const body = SetupSchema.parse(request.body || {});

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });

    if (!user) {
      throw new NotFoundError("User not found");
    }

    const appName =
      body?.appName || (await this.configService.getValue("appName")) || "OUITRANSFER";

    const setupData = await this.twoFactorService.generateSetup(userId, user.email, appName);

    return reply.send(setupData);
  }

  /**
   * Verify setup token and enable 2FA
   */
  async verifySetup(request: FastifyRequest, reply: FastifyReply) {
    const userId = request.user?.userId;
    if (!userId) {
      throw new UnauthorizedError();
    }

    const body = VerifySetupSchema.parse(request.body);

    const result = await this.twoFactorService.verifySetup(userId, body.token, body.secret);

    // Audit 2FA enable (fire-and-forget)
    logAuditEvent({
      userId,
      action: "TWO_FACTOR_ENABLE",
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"],
    }).catch((err) => getLogger().error({ err }, "Audit log write failed"));

    return reply.send(result);
  }

  /**
   * Verify 2FA token during login
   */
  async verifyToken(request: FastifyRequest, reply: FastifyReply) {
    const userId = request.user?.userId;
    if (!userId) {
      throw new UnauthorizedError();
    }

    const body = VerifyTokenSchema.parse(request.body);

    const result = await this.twoFactorService.verifyToken(userId, body.token);

    return reply.send(result);
  }

  /**
   * Disable 2FA
   */
  async disable2FA(request: FastifyRequest, reply: FastifyReply) {
    const userId = request.user?.userId;
    if (!userId) {
      throw new UnauthorizedError();
    }

    const body = DisableSchema.parse(request.body);

    const result = await this.twoFactorService.disable2FA(userId, body.password, body.totpCode);

    // Audit 2FA disable (fire-and-forget)
    logAuditEvent({
      userId,
      action: "TWO_FACTOR_DISABLE",
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"],
    }).catch((err) => getLogger().error({ err }, "Audit log write failed"));

    return reply.send(result);
  }

  /**
   * Generate new backup codes
   */
  async generateBackupCodes(request: FastifyRequest, reply: FastifyReply) {
    const userId = request.user?.userId;
    if (!userId) {
      throw new UnauthorizedError();
    }

    const codes = await this.twoFactorService.generateNewBackupCodes(userId);

    return reply.send({ backupCodes: codes });
  }

  /**
   * Get 2FA status
   */
  async getStatus(request: FastifyRequest, reply: FastifyReply) {
    const userId = request.user?.userId;
    if (!userId) {
      throw new UnauthorizedError();
    }

    const status = await this.twoFactorService.getStatus(userId);

    return reply.send(status);
  }
}
