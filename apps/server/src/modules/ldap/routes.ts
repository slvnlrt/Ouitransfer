import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createAdminPreValidation } from "../../middleware/admin-prevalidation.js";
import { ErrorResponseSchema } from "../../utils/error-response-schema.js";
import { LdapController } from "./controller.js";
import { LdapConfigSchema, LdapTestSchema, SyncLogsQuerySchema } from "./dto.js";

export async function ldapRoutes(app: FastifyInstance) {
  const controller = new LdapController();
  const adminPreValidation = createAdminPreValidation({
    allowSetupBypass: false,
  });

  // GET /admin/ldap/config
  app.get("/admin/ldap/config", {
    preValidation: [adminPreValidation],
    schema: {
      tags: ["ldap"],
      operationId: "getLdapConfig",
      summary: "Get LDAP configuration",
      response: {
        200: z.object({}).passthrough(),
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
      },
    },
    handler: controller.getConfig.bind(controller),
  });

  // PUT /admin/ldap/config — body validated by Fastify via LdapConfigSchema
  app.put("/admin/ldap/config", {
    preValidation: [adminPreValidation],
    schema: {
      tags: ["ldap"],
      operationId: "updateLdapConfig",
      summary: "Create or update LDAP configuration",
      body: LdapConfigSchema,
      response: {
        200: z.object({}).passthrough(),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
      },
    },
    handler: controller.updateConfig.bind(controller),
  });

  // POST /admin/ldap/test — body validated by Fastify via LdapTestSchema
  app.post("/admin/ldap/test", {
    preValidation: [adminPreValidation],
    schema: {
      tags: ["ldap"],
      operationId: "testLdapConnection",
      summary: "Test LDAP connection",
      body: LdapTestSchema,
      response: {
        200: z.object({
          success: z.boolean(),
          memberCount: z.number(),
          message: z.string(),
        }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
      },
    },
    handler: controller.testConnection.bind(controller),
  });

  // POST /admin/ldap/sync
  app.post("/admin/ldap/sync", {
    preValidation: [adminPreValidation],
    schema: {
      tags: ["ldap"],
      operationId: "triggerLdapSync",
      summary: "Trigger manual LDAP sync",
      response: {
        200: z.object({ logId: z.string() }),
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    handler: controller.triggerSync.bind(controller),
  });

  // GET /admin/ldap/sync/logs
  app.get("/admin/ldap/sync/logs", {
    preValidation: [adminPreValidation],
    schema: {
      tags: ["ldap"],
      operationId: "getLdapSyncLogs",
      summary: "List LDAP sync history",
      querystring: SyncLogsQuerySchema,
      response: {
        200: z.object({}).passthrough(),
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
      },
    },
    handler: controller.getSyncLogs.bind(controller),
  });

  // GET /admin/ldap/sync/logs/:id
  app.get("/admin/ldap/sync/logs/:id", {
    preValidation: [adminPreValidation],
    schema: {
      tags: ["ldap"],
      operationId: "getLdapSyncLogDetail",
      summary: "Get LDAP sync log detail",
      params: z.object({ id: z.string() }),
      response: {
        200: z.object({}).passthrough(),
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: controller.getSyncLogDetail.bind(controller),
  });

  // GET /admin/ldap/status
  app.get("/admin/ldap/status", {
    preValidation: [adminPreValidation],
    schema: {
      tags: ["ldap"],
      operationId: "getLdapStatus",
      summary: "Get LDAP sync status",
      response: {
        200: z.object({}).passthrough(),
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
      },
    },
    handler: controller.getStatus.bind(controller),
  });
}
