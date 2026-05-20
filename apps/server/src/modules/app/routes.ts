import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { createAdminPreValidation } from "../../middleware/admin-prevalidation.js";
import { ValidationError } from "../../utils/app-error.js";
import { ErrorResponseSchema } from "../../utils/error-response-schema.js";
import { getLogger } from "../../utils/logger.js";
import { logAuditEvent } from "../audit/service.js";
import { EmailService } from "../email/service.js";
import { BulkUpdateConfigSchema, ConfigResponseSchema } from "./dto.js";
import { LogoService } from "./logo.service.js";
import { AppService } from "./service.js";

/** Body size limit for admin config endpoints — payloads are small JSON only. */
const SMALL_BODY_LIMIT = 64 * 1024; // 64 KB

const appService = new AppService();
const logoService = new LogoService();
const emailService = new EmailService();

const adminPreValidation = createAdminPreValidation({ allowSetupBypass: true });

export const appRoutes: FastifyPluginAsyncZod = async (app) => {
  app.route({
    method: "GET",
    url: "/app/info",
    schema: {
      tags: ["App"],
      operationId: "getAppInfo",
      summary: "Get application base information",
      description: "Get application base information",
      response: {
        200: z.object({
          appName: z.string().describe("The application name"),
          appDescription: z.string().describe("The application description"),
          appLogo: z.string().describe("The application logo"),
          firstUserAccess: z.boolean().describe("Whether it's the first user access"),
        }),
        400: ErrorResponseSchema,
      },
    },
    handler: async (_request, reply) => {
      const appInfo = await appService.getAppInfo();
      return reply.send(appInfo);
    },
  });

  app.route({
    method: "GET",
    url: "/app/system-info",
    schema: {
      tags: ["App"],
      operationId: "getSystemInfo",
      summary: "Get system information",
      description: "Get system information including storage provider",
      response: {
        200: z.object({
          storageProvider: z.enum(["s3", "filesystem"]).describe("The active storage provider"),
          s3Enabled: z.boolean().describe("Whether S3 storage is enabled"),
        }),
        400: ErrorResponseSchema,
      },
    },
    handler: async (_request, reply) => {
      const systemInfo = await appService.getSystemInfo();
      return reply.send(systemInfo);
    },
  });

  app.route({
    method: "PATCH",
    url: "/app/configs/:key",
    bodyLimit: SMALL_BODY_LIMIT,
    preValidation: adminPreValidation,
    schema: {
      tags: ["App"],
      operationId: "updateConfig",
      summary: "Update a configuration value",
      description: "Update a configuration value (admin only)",
      params: z.object({
        key: z.string().describe("The config key"),
      }),
      body: z.object({
        value: z.string().describe("The config value"),
      }),
      response: {
        200: z.object({
          config: ConfigResponseSchema,
        }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const config = await appService.updateConfig(request.params.key, request.body.value);

      // Audit admin config change (fire-and-forget)
      logAuditEvent({
        userId: request.user?.userId,
        action: "ADMIN_CONFIG_CHANGE",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        metadata: { key: request.params.key },
      }).catch((err) => getLogger().error({ err }, "Audit log write failed"));

      return reply.send({ config });
    },
  });

  app.route({
    method: "GET",
    url: "/app/configs/public",
    schema: {
      tags: ["App"],
      operationId: "getPublicConfigs",
      summary: "List public configurations",
      description: "List public configurations (excludes sensitive data like SMTP credentials)",
      response: {
        200: z.object({
          configs: z.array(ConfigResponseSchema),
        }),
        400: ErrorResponseSchema,
      },
    },
    handler: async (_request, reply) => {
      const configs = await appService.getPublicConfigs();
      return reply.send({ configs });
    },
  });

  app.route({
    method: "GET",
    url: "/app/configs",
    preValidation: adminPreValidation,
    schema: {
      tags: ["App"],
      operationId: "getAllConfigs",
      summary: "List all configurations",
      description: "List all configurations including sensitive data (admin only)",
      response: {
        200: z.object({
          configs: z.array(ConfigResponseSchema),
        }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
      },
    },
    handler: async (_request, reply) => {
      const configs = await appService.getAllConfigs();
      return reply.send({ configs });
    },
  });

  app.route({
    method: "PATCH",
    url: "/app/configs",
    bodyLimit: SMALL_BODY_LIMIT,
    preValidation: adminPreValidation,
    schema: {
      tags: ["App"],
      operationId: "bulkUpdateConfigs",
      summary: "Bulk update configuration values",
      description: "Bulk update configuration values (admin only)",
      body: BulkUpdateConfigSchema,
      response: {
        200: z.object({
          configs: z.array(ConfigResponseSchema),
        }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const configs = await appService.bulkUpdateConfigs(request.body);

      // Audit admin config change (fire-and-forget)
      logAuditEvent({
        userId: request.user?.userId,
        action: "ADMIN_CONFIG_CHANGE",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        metadata: { keys: request.body.map((u) => u.key) },
      }).catch((err) => getLogger().error({ err }, "Audit log write failed"));

      return reply.send({ configs });
    },
  });

  app.route({
    method: "POST",
    url: "/app/test-smtp",
    preValidation: adminPreValidation,
    schema: {
      tags: ["App"],
      operationId: "testSmtpConnection",
      summary: "Test SMTP connection with provided or saved configuration",
      description:
        "Validates SMTP connectivity using either provided configuration parameters or the currently saved settings. This endpoint allows testing SMTP settings before saving them permanently. Requires admin privileges.",
      body: z
        .object({
          smtpConfig: z
            .object({
              smtpEnabled: z.string().describe("Whether SMTP is enabled ('true' or 'false')"),
              smtpHost: z
                .string()
                .describe("SMTP server hostname or IP address (e.g., 'smtp.gmail.com')"),
              smtpPort: z
                .union([z.string(), z.number()])
                .transform(String)
                .describe("SMTP server port (typically 587 for TLS, 25 for non-secure)"),
              smtpUser: z
                .string()
                .describe("Username for SMTP authentication (e.g., email address)"),
              smtpPass: z
                .string()
                .describe("Password for SMTP authentication (for Gmail, use App Password)"),
              smtpSecure: z
                .string()
                .optional()
                .describe("Connection security method ('auto', 'ssl', 'tls', or 'none')"),
              smtpNoAuth: z
                .string()
                .optional()
                .describe("Disable SMTP authentication ('true' or 'false')"),
              smtpTrustSelfSigned: z
                .string()
                .optional()
                .describe("Trust self-signed certificates ('true' or 'false')"),
            })
            .optional()
            .describe(
              "SMTP configuration to test. If not provided, uses currently saved configuration",
            ),
        })
        .optional()
        .describe(
          "Request body containing SMTP configuration to test. Send empty body to test saved configuration",
        ),
      response: {
        200: z.object({
          success: z.boolean().describe("Whether the SMTP connection test was successful"),
          message: z.string().describe("Descriptive message about the test result"),
        }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const smtpConfig = request.body?.smtpConfig;
      const result = await emailService.testConnection(smtpConfig);
      return reply.send(result);
    },
  });

  app.route({
    method: "POST",
    url: "/app/logo",
    preValidation: adminPreValidation,
    schema: {
      tags: ["App"],
      operationId: "uploadLogo",
      summary: "Upload app logo",
      description: "Upload a new app logo (admin only)",
      response: {
        200: z.object({
          logo: z.string().describe("The logo URL"),
        }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
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
      const base64Logo = await logoService.uploadLogo(buffer);
      await appService.updateConfig("appLogo", base64Logo);

      return reply.send({ logo: base64Logo });
    },
  });

  app.route({
    method: "DELETE",
    url: "/app/logo",
    preValidation: adminPreValidation,
    schema: {
      tags: ["App"],
      operationId: "removeLogo",
      summary: "Remove app logo",
      description: "Remove the current app logo (admin only)",
      response: {
        200: z.object({
          message: z.string().describe("Success message"),
        }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
      },
    },
    handler: async (_request, reply) => {
      await logoService.deleteLogo();
      return reply.send({ message: "Logo removed successfully" });
    },
  });
};
