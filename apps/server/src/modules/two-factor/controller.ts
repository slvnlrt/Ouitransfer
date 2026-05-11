import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { prisma } from "../../shared/prisma.js";
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
    try {
      const userId = request.user?.userId;
      if (!userId) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      const body = SetupSchema.parse(request.body || {});

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });

      if (!user) {
        return reply.status(404).send({ error: "User not found" });
      }

      const appName =
        body?.appName || (await this.configService.getValue("appName")) || "OUITRANSFER";

      const setupData = await this.twoFactorService.generateSetup(userId, user.email, appName);

      return reply.send(setupData);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send({ error: message });
    }
  }

  /**
   * Verify setup token and enable 2FA
   */
  async verifySetup(request: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = request.user?.userId;
      if (!userId) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      const body = VerifySetupSchema.parse(request.body);

      const result = await this.twoFactorService.verifySetup(userId, body.token, body.secret);

      return reply.send(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send({ error: message });
    }
  }

  /**
   * Verify 2FA token during login
   */
  async verifyToken(request: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = request.user?.userId;
      if (!userId) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      const body = VerifyTokenSchema.parse(request.body);

      const result = await this.twoFactorService.verifyToken(userId, body.token);

      return reply.send(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send({ error: message });
    }
  }

  /**
   * Disable 2FA
   */
  async disable2FA(request: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = request.user?.userId;
      if (!userId) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      const body = DisableSchema.parse(request.body);

      const result = await this.twoFactorService.disable2FA(userId, body.password, body.totpCode);

      return reply.send(result);
    } catch (error: unknown) {
      request.log.error({ err: error }, "2FA Disable Error");
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send({ error: message });
    }
  }

  /**
   * Generate new backup codes
   */
  async generateBackupCodes(request: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = request.user?.userId;
      if (!userId) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      const codes = await this.twoFactorService.generateNewBackupCodes(userId);

      return reply.send({ backupCodes: codes });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send({ error: message });
    }
  }

  /**
   * Get 2FA status
   */
  async getStatus(request: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = request.user?.userId;
      if (!userId) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      const status = await this.twoFactorService.getStatus(userId);

      return reply.send(status);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send({ error: message });
    }
  }
}
