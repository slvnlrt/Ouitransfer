import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { createAdminPreValidation } from "../../middleware/admin-prevalidation.js";
import { NotFoundError, ValidationError } from "../../utils/app-error.js";
import { ErrorResponseSchema } from "../../utils/error-response-schema.js";
import { LdapConfigRepository } from "./config.repository.js";
import { LdapConfigSchema, LdapTestSchema, SyncLogsQuerySchema } from "./dto.js";
import { encrypt } from "./encryption.js";
import { LdapClient } from "./ldap.client.js";
import { LdapSyncLogRepository } from "./sync.repository.js";
import { getNextSyncAt, startScheduler, stopScheduler } from "./sync.scheduler.js";
import { LdapSyncService } from "./sync.service.js";

const MASKED_PASSWORD = "••••••••";

const configRepository = new LdapConfigRepository();
const syncLogRepository = new LdapSyncLogRepository();
const syncService = new LdapSyncService();

const adminPreValidation = createAdminPreValidation({ allowSetupBypass: false });

export const ldapRoutes: FastifyPluginAsyncZod = async (app) => {
  app.route({
    method: "GET",
    url: "/admin/ldap/config",
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
    handler: async (_request, reply) => {
      const config = await configRepository.get();
      if (!config) {
        return reply.send({ configured: false });
      }
      return reply.send({
        configured: true,
        id: config.id,
        enabled: config.enabled,
        serverUrl: config.serverUrl,
        bindDn: config.bindDn,
        bindPassword: MASKED_PASSWORD,
        searchBase: config.searchBase,
        syncGroupDn: config.syncGroupDn,
        usernameAttribute: config.usernameAttribute,
        emailAttribute: config.emailAttribute,
        displayNameAttribute: config.displayNameAttribute,
        syncIntervalMinutes: config.syncIntervalMinutes,
        useTls: config.useTls,
        tlsSkipVerify: config.tlsSkipVerify,
        appUrl: config.appUrl,
        createdAt: config.createdAt,
        updatedAt: config.updatedAt,
      });
    },
  });

  app.route({
    method: "PUT",
    url: "/admin/ldap/config",
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
    handler: async (request, reply) => {
      const data = request.body;

      // appUrl is required when enabling LDAP (used for welcome emails)
      if (data.enabled && !data.appUrl) {
        throw new ValidationError(
          "Application URL is required when LDAP is enabled (used for welcome emails)",
        );
      }

      // Handle bind password
      let bindPassword: string;
      if (data.bindPassword && data.bindPassword !== MASKED_PASSWORD) {
        // Validate ENCRYPTION_SECRET is set before attempting to encrypt
        if (!process.env.ENCRYPTION_SECRET) {
          throw new ValidationError(
            "ENCRYPTION_SECRET environment variable must be set to save LDAP configuration with a bind password",
          );
        }
        bindPassword = encrypt(data.bindPassword);
      } else {
        const existing = await configRepository.get();
        if (!existing) {
          throw new ValidationError("Bind password is required for new configuration");
        }
        bindPassword = existing.bindPassword;
      }

      const config = await configRepository.upsert({
        enabled: data.enabled,
        serverUrl: data.serverUrl,
        bindDn: data.bindDn,
        bindPassword,
        searchBase: data.searchBase,
        syncGroupDn: data.syncGroupDn,
        usernameAttribute: data.usernameAttribute,
        emailAttribute: data.emailAttribute,
        displayNameAttribute: data.displayNameAttribute,
        syncIntervalMinutes: data.syncIntervalMinutes,
        useTls: data.useTls,
        tlsSkipVerify: data.tlsSkipVerify,
        appUrl: data.appUrl ?? null,
      });

      // Reload scheduler
      if (config.enabled) {
        startScheduler(config.syncIntervalMinutes);
      } else {
        stopScheduler();
      }

      return reply.send({
        configured: true,
        id: config.id,
        enabled: config.enabled,
        serverUrl: config.serverUrl,
        bindDn: config.bindDn,
        bindPassword: MASKED_PASSWORD,
        searchBase: config.searchBase,
        syncGroupDn: config.syncGroupDn,
        usernameAttribute: config.usernameAttribute,
        emailAttribute: config.emailAttribute,
        displayNameAttribute: config.displayNameAttribute,
        syncIntervalMinutes: config.syncIntervalMinutes,
        useTls: config.useTls,
        tlsSkipVerify: config.tlsSkipVerify,
        appUrl: config.appUrl,
        createdAt: config.createdAt,
        updatedAt: config.updatedAt,
      });
    },
  });

  app.route({
    method: "POST",
    url: "/admin/ldap/test",
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
    handler: async (request, reply) => {
      const data = request.body;
      const client = new LdapClient();
      const result = await client.testConnection({
        serverUrl: data.serverUrl,
        bindDn: data.bindDn,
        bindPassword: data.bindPassword,
        useTls: data.useTls,
        tlsSkipVerify: data.tlsSkipVerify,
        searchBase: data.searchBase,
        syncGroupDn: data.syncGroupDn,
        usernameAttribute: data.usernameAttribute,
        emailAttribute: data.emailAttribute,
        displayNameAttribute: data.displayNameAttribute,
      });
      return reply.send(result);
    },
  });

  app.route({
    method: "POST",
    url: "/admin/ldap/sync",
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
    handler: async (_request, reply) => {
      const logId = await syncService.runSync("manual");
      return reply.send({ logId });
    },
  });

  app.route({
    method: "GET",
    url: "/admin/ldap/sync/logs",
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
    handler: async (request, reply) => {
      const { limit, offset } = request.query;
      const result = await syncLogRepository.list(limit, offset);
      return reply.send(result);
    },
  });

  app.route({
    method: "GET",
    url: "/admin/ldap/sync/logs/:id",
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
    handler: async (request, reply) => {
      const log = await syncLogRepository.getById(request.params.id);
      if (!log) {
        throw new NotFoundError("Sync log not found");
      }
      return reply.send(log);
    },
  });

  app.route({
    method: "GET",
    url: "/admin/ldap/status",
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
    handler: async (_request, reply) => {
      const config = await configRepository.get();
      const lastLog = await syncLogRepository.getLatest();

      const warnings: string[] = [];
      if (!process.env.ENCRYPTION_SECRET && config) {
        warnings.push("ENCRYPTION_SECRET is not set — LDAP password encryption is unavailable");
      }

      return reply.send({
        configured: !!config,
        enabled: config?.enabled ?? false,
        syncInProgress: syncService.isSyncInProgress(),
        lastSync: lastLog
          ? {
              id: lastLog.id,
              status: lastLog.status,
              startedAt: lastLog.startedAt,
              completedAt: lastLog.completedAt,
              usersCreated: lastLog.usersCreated,
              usersUpdated: lastLog.usersUpdated,
              usersDeactivated: lastLog.usersDeactivated,
              usersReactivated: lastLog.usersReactivated,
              usersSkipped: lastLog.usersSkipped,
            }
          : null,
        nextSyncAt: getNextSyncAt(),
        warnings,
      });
    },
  });
};
