import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { prisma } from "../../shared/prisma.js";
import { AppController } from "./controller.js";
import { BulkUpdateConfigSchema, ConfigResponseSchema } from "./dto.js";

export async function appRoutes(app: FastifyInstance) {
  const appController = new AppController();

  const adminPreValidation = async (request: FastifyRequest, reply: FastifyReply) => {
    // Count users — this is a separate concern from JWT verification.
    // DB errors must propagate to globalErrorHandler, not be swallowed as 401.
    const usersCount = await prisma.user.count();

    // Only skip auth before any user is registered (initial setup).
    // Once even one user exists, all admin endpoints require authentication.
    // NOTE: During the setup window (usersCount === 0), admin endpoints are
    // unprotected. This is acceptable for initial setup only. A future
    // improvement could restrict this bypass to the "create first user" route.
    if (usersCount === 0) {
      return;
    }

    // JWT verification — failures should return 401 Unauthorized.
    try {
      await request.jwtVerify();
    } catch (err) {
      request.log.warn({ err }, "Admin JWT verification failed");
      return reply.status(401).send({ error: "Unauthorized" });
    }

    if (!request.user.isAdmin) {
      return reply.status(403).send({ error: "Access restricted to administrators" });
    }
  };

  app.get(
    "/app/info",
    {
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
          400: z.object({ error: z.string().describe("Error message") }),
        },
      },
    },
    appController.getAppInfo.bind(appController),
  );

  app.get(
    "/app/system-info",
    {
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
          400: z.object({ error: z.string().describe("Error message") }),
        },
      },
    },
    appController.getSystemInfo.bind(appController),
  );

  app.patch(
    "/app/configs/:key",
    {
      bodyLimit: 64 * 1024, // 64 KB — admin config payloads are small JSON
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
          400: z.object({ error: z.string().describe("Error message") }),
          401: z.object({ error: z.string().describe("Error message") }),
          403: z.object({ error: z.string().describe("Error message") }),
          404: z.object({ error: z.string().describe("Error message") }),
        },
      },
    },
    appController.updateConfig.bind(appController),
  );

  app.get(
    "/app/configs/public",
    {
      schema: {
        tags: ["App"],
        operationId: "getPublicConfigs",
        summary: "List public configurations",
        description: "List public configurations (excludes sensitive data like SMTP credentials)",
        response: {
          200: z.object({
            configs: z.array(ConfigResponseSchema),
          }),
          400: z.object({ error: z.string().describe("Error message") }),
        },
      },
    },
    appController.getPublicConfigs.bind(appController),
  );

  app.get(
    "/app/configs",
    {
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
          400: z.object({ error: z.string().describe("Error message") }),
          401: z.object({ error: z.string().describe("Error message") }),
          403: z.object({ error: z.string().describe("Error message") }),
        },
      },
    },
    appController.getAllConfigs.bind(appController),
  );

  app.patch(
    "/app/configs",
    {
      bodyLimit: 64 * 1024, // 64 KB — admin config payloads are small JSON
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
          400: z.object({ error: z.string().describe("Error message") }),
          401: z.object({ error: z.string().describe("Error message") }),
          403: z.object({ error: z.string().describe("Error message") }),
        },
      },
    },
    appController.bulkUpdateConfigs.bind(appController),
  );

  app.post(
    "/app/test-smtp",
    {
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
          400: z.object({
            error: z.string().describe("Error message describing what went wrong with the test"),
          }),
          401: z.object({
            error: z.string().describe("Authentication error - invalid or missing JWT token"),
          }),
          403: z.object({
            error: z.string().describe("Authorization error - user does not have admin privileges"),
          }),
        },
      },
    },
    appController.testSmtpConnection.bind(appController),
  );

  app.post(
    "/app/logo",
    {
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
          400: z.object({ error: z.string().describe("Error message") }),
          401: z.object({ error: z.string().describe("Error message") }),
          403: z.object({ error: z.string().describe("Error message") }),
        },
      },
    },
    appController.uploadLogo.bind(appController),
  );

  app.delete(
    "/app/logo",
    {
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
          400: z.object({ error: z.string().describe("Error message") }),
          401: z.object({ error: z.string().describe("Error message") }),
          403: z.object({ error: z.string().describe("Error message") }),
        },
      },
    },
    appController.removeLogo.bind(appController),
  );
}
