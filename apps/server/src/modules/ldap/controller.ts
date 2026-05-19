import type { FastifyReply, FastifyRequest } from "fastify";
import { NotFoundError, ValidationError } from "../../utils/app-error.js";
import { LdapConfigRepository } from "./config.repository.js";
import { LdapConfigSchema, LdapTestSchema, SyncLogsQuerySchema } from "./dto.js";
import { encrypt } from "./encryption.js";
import { LdapClient } from "./ldap.client.js";
import { LdapSyncLogRepository } from "./sync.repository.js";
import { getNextSyncAt, startScheduler, stopScheduler } from "./sync.scheduler.js";
import { LdapSyncService } from "./sync.service.js";

const MASKED_PASSWORD = "••••••••";

export class LdapController {
  private configRepository = new LdapConfigRepository();
  private syncLogRepository = new LdapSyncLogRepository();
  private syncService = new LdapSyncService();

  async getConfig(_request: FastifyRequest, reply: FastifyReply) {
    const config = await this.configRepository.get();
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
      appUrl: config.appUrl,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    });
  }

  async updateConfig(request: FastifyRequest, reply: FastifyReply) {
    const data = LdapConfigSchema.parse(request.body);

    // Handle bind password
    let bindPassword: string;
    if (data.bindPassword && data.bindPassword !== MASKED_PASSWORD) {
      bindPassword = encrypt(data.bindPassword);
    } else {
      const existing = await this.configRepository.get();
      if (!existing) {
        throw new ValidationError("Bind password is required for new configuration");
      }
      bindPassword = existing.bindPassword;
    }

    const config = await this.configRepository.upsert({
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
      appUrl: config.appUrl,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    });
  }

  async testConnection(request: FastifyRequest, reply: FastifyReply) {
    const data = LdapTestSchema.parse(request.body);
    const client = new LdapClient();
    const result = await client.testConnection({
      serverUrl: data.serverUrl,
      bindDn: data.bindDn,
      bindPassword: data.bindPassword,
      useTls: data.useTls,
      searchBase: data.searchBase,
      syncGroupDn: data.syncGroupDn,
      usernameAttribute: data.usernameAttribute,
      emailAttribute: data.emailAttribute,
      displayNameAttribute: data.displayNameAttribute,
    });
    return reply.send(result);
  }

  async triggerSync(_request: FastifyRequest, reply: FastifyReply) {
    const logId = await this.syncService.runSync("manual");
    return reply.send({ logId });
  }

  async getSyncLogs(request: FastifyRequest, reply: FastifyReply) {
    const { limit, offset } = SyncLogsQuerySchema.parse(request.query);
    const result = await this.syncLogRepository.list(limit, offset);
    return reply.send(result);
  }

  async getSyncLogDetail(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    const log = await this.syncLogRepository.getById(id);
    if (!log) {
      throw new NotFoundError("Sync log not found");
    }
    return reply.send(log);
  }

  async getStatus(_request: FastifyRequest, reply: FastifyReply) {
    const config = await this.configRepository.get();
    const lastLog = await this.syncLogRepository.getLatest();

    return reply.send({
      configured: !!config,
      enabled: config?.enabled ?? false,
      syncInProgress: this.syncService.isSyncInProgress(),
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
    });
  }
}
