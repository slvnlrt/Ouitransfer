import type { FastifyReply, FastifyRequest } from "fastify";

import { ForbiddenError, ValidationError } from "../../utils/app-error.js";
import { getLogger } from "../../utils/logger.js";
import { logAuditEvent } from "../audit/service.js";
import { EmailService } from "../email/service.js";
import { LogoService } from "./logo.service.js";
import { AppService } from "./service.js";

export class AppController {
  private appService = new AppService();
  private logoService = new LogoService();
  private emailService = new EmailService();

  async getAppInfo(_request: FastifyRequest, reply: FastifyReply) {
    const appInfo = await this.appService.getAppInfo();
    return reply.send(appInfo);
  }

  async getSystemInfo(_request: FastifyRequest, reply: FastifyReply) {
    const systemInfo = await this.appService.getSystemInfo();
    return reply.send(systemInfo);
  }

  async getAllConfigs(_request: FastifyRequest, reply: FastifyReply) {
    const configs = await this.appService.getAllConfigs();
    return reply.send({ configs });
  }

  async getPublicConfigs(_request: FastifyRequest, reply: FastifyReply) {
    const configs = await this.appService.getPublicConfigs();
    return reply.send({ configs });
  }

  async updateConfig(request: FastifyRequest, reply: FastifyReply) {
    const { key } = request.params as { key: string };
    const { value } = request.body as { value: string };

    const config = await this.appService.updateConfig(key, value);

    // Audit admin config change (fire-and-forget)
    logAuditEvent({
      userId: request.user?.userId,
      action: "ADMIN_CONFIG_CHANGE",
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"],
      metadata: { key },
    }).catch((err) => getLogger().error({ err }, "Audit log write failed"));

    return reply.send({ config });
  }

  async bulkUpdateConfigs(request: FastifyRequest, reply: FastifyReply) {
    const updates = request.body as Array<{ key: string; value: string }>;
    const configs = await this.appService.bulkUpdateConfigs(updates);

    // Audit admin config change (fire-and-forget)
    logAuditEvent({
      userId: request.user?.userId,
      action: "ADMIN_CONFIG_CHANGE",
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"],
      metadata: { keys: updates.map((u) => u.key) },
    }).catch((err) => getLogger().error({ err }, "Audit log write failed"));

    return reply.send({ configs });
  }

  async testSmtpConnection(request: FastifyRequest, reply: FastifyReply) {
    await request.jwtVerify();

    if (!request.user?.isAdmin) {
      throw new ForbiddenError("Access restricted to administrators");
    }

    const body = request.body as {
      smtpConfig?: {
        smtpEnabled: string;
        smtpHost: string;
        smtpPort: string;
        smtpUser: string;
        smtpPass: string;
        smtpSecure?: string;
        smtpNoAuth?: string;
        smtpTrustSelfSigned?: string;
      };
    };
    const smtpConfig = body.smtpConfig || undefined;

    const result = await this.emailService.testConnection(smtpConfig);
    return reply.send(result);
  }

  async uploadLogo(request: FastifyRequest, reply: FastifyReply) {
    const file = await request.file();
    if (!file) {
      throw new ValidationError("No file uploaded");
    }

    if (!file.mimetype.startsWith("image/")) {
      throw new ValidationError("Only images are allowed");
    }

    const chunks: Buffer[] = [];
    const maxLogoSize = 5 * 1024 * 1024;
    let totalSize = 0;

    for await (const chunk of file.file) {
      totalSize += chunk.length;
      if (totalSize > maxLogoSize) {
        throw new ValidationError("Logo file too large. Maximum size is 5MB.");
      }
      chunks.push(chunk);
    }

    const buffer = Buffer.concat(chunks);
    const base64Logo = await this.logoService.uploadLogo(buffer);
    await this.appService.updateConfig("appLogo", base64Logo);

    return reply.send({ logo: base64Logo });
  }

  async removeLogo(_request: FastifyRequest, reply: FastifyReply) {
    await this.logoService.deleteLogo();
    return reply.send({ message: "Logo removed successfully" });
  }
}
