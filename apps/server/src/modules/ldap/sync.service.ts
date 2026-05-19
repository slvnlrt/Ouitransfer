import crypto from "node:crypto";
import { prisma } from "../../shared/prisma.js";
import { ConflictError } from "../../utils/app-error.js";
import { getLogger } from "../../utils/logger.js";
import { EmailService } from "../email/service.js";
import { LdapConfigRepository } from "./config.repository.js";
import { decrypt } from "./encryption.js";
import type { LdapUserEntry } from "./ldap.client.js";
import { LdapClient } from "./ldap.client.js";
import { LdapSyncLogRepository } from "./sync.repository.js";

// ── Types ────────────────────────────────────────────────────────────────────

interface SyncDetail {
  type: "skip" | "error";
  username: string;
  email?: string;
  message: string;
}

interface SyncStats {
  created: number;
  updated: number;
  deactivated: number;
  skipped: number;
  reactivated: number;
  details: SyncDetail[];
}

// ── Module-level mutex ───────────────────────────────────────────────────────
// ES modules are singletons — one instance of this flag per process.

let syncInProgress = false;

// ── Service ──────────────────────────────────────────────────────────────────

export class LdapSyncService {
  private configRepository = new LdapConfigRepository();
  private syncLogRepository = new LdapSyncLogRepository();
  private ldapClient = new LdapClient();
  private emailService = new EmailService();

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Returns true while a sync is in progress. */
  isSyncInProgress(): boolean {
    return syncInProgress;
  }

  /**
   * Run a full LDAP sync cycle.
   * Returns the sync-log ID.
   * Throws ConflictError if a sync is already in progress.
   */
  async runSync(trigger: "scheduled" | "manual"): Promise<string> {
    if (syncInProgress) {
      throw new ConflictError("LDAP sync already in progress");
    }

    syncInProgress = true;
    const log = await this.syncLogRepository.create({ trigger, status: "running" });

    try {
      const config = await this.configRepository.get();
      if (!config) throw new Error("LDAP configuration not found");
      if (!config.enabled) throw new Error("LDAP sync is disabled");

      const bindPassword = decrypt(config.bindPassword);

      await this.ldapClient.connect({
        serverUrl: config.serverUrl,
        bindDn: config.bindDn,
        bindPassword,
        useTls: config.useTls,
      });

      const adUsers = await this.ldapClient.searchSyncGroupMembers({
        searchBase: config.searchBase,
        syncGroupDn: config.syncGroupDn,
        usernameAttribute: config.usernameAttribute,
        emailAttribute: config.emailAttribute,
        displayNameAttribute: config.displayNameAttribute,
      });

      await this.ldapClient.disconnect();

      const appUrl = config.appUrl ?? "";
      const stats = await this.performSync(adUsers, appUrl);

      const hasErrors = stats.details.some((d) => d.type === "error");
      const hasSkips = stats.skipped > 0;
      const status = hasErrors || hasSkips ? "partial" : "success";

      await this.syncLogRepository.complete(log.id, {
        status,
        usersCreated: stats.created,
        usersUpdated: stats.updated,
        usersDeactivated: stats.deactivated,
        usersSkipped: stats.skipped,
        usersReactivated: stats.reactivated,
        details: JSON.stringify(stats.details),
      });

      return log.id;
    } catch (error) {
      // Best-effort disconnect on error
      await this.ldapClient.disconnect();

      const message = error instanceof Error ? error.message : "Unknown error";
      await this.syncLogRepository.complete(log.id, {
        status: "error",
        usersCreated: 0,
        usersUpdated: 0,
        usersDeactivated: 0,
        usersSkipped: 0,
        usersReactivated: 0,
        details: JSON.stringify([{ type: "error" as const, username: "", message }]),
      });

      throw error;
    } finally {
      syncInProgress = false;
    }
  }

  // ── Core diff logic ────────────────────────────────────────────────────────

  private async performSync(adUsers: LdapUserEntry[], appUrl: string): Promise<SyncStats> {
    const stats: SyncStats = {
      created: 0,
      updated: 0,
      deactivated: 0,
      skipped: 0,
      reactivated: 0,
      details: [],
    };

    // Fetch all local LDAP-managed users (ldapDn IS NOT NULL)
    const localLdapUsers = await prisma.user.findMany({
      where: { ldapDn: { not: null } },
    });

    // Fetch all groups that have an LDAP DN mapping
    const groups = await prisma.group.findMany({
      where: { ldapDn: { not: null } },
    });

    // Build a map of dn → local user for fast lookup
    const localByDn = new Map<string, (typeof localLdapUsers)[0]>();
    for (const u of localLdapUsers) {
      if (u.ldapDn) localByDn.set(u.ldapDn, u);
    }

    // Build a set of all AD DNs for the deactivation pass
    const adUserDns = new Set<string>(adUsers.map((u) => u.dn));

    // Process each AD user
    for (const adUser of adUsers) {
      await this.processAdUser(adUser, localByDn, groups, appUrl, stats);
    }

    // Deactivate local LDAP users no longer in AD
    for (const localUser of localLdapUsers) {
      if (localUser.isActive && localUser.ldapDn && !adUserDns.has(localUser.ldapDn)) {
        try {
          await prisma.user.update({
            where: { id: localUser.id },
            data: { isActive: false },
          });
          stats.deactivated++;
          getLogger().info(
            { userId: localUser.id, username: localUser.username },
            "LDAP: deactivated user",
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          stats.details.push({ type: "error", username: localUser.username, message });
        }
      }
    }

    return stats;
  }

  private async processAdUser(
    adUser: LdapUserEntry,
    localByDn: Map<
      string,
      {
        id: string;
        username: string;
        email: string;
        firstName: string;
        lastName: string;
        isActive: boolean;
        groupId: string | null;
        ldapDn: string | null;
      }
    >,
    groups: { id: string; ldapDn: string | null }[],
    appUrl: string,
    stats: SyncStats,
  ): Promise<void> {
    // Skip if no email
    if (!adUser.email || adUser.email.trim() === "") {
      stats.skipped++;
      stats.details.push({
        type: "skip",
        username: adUser.username,
        message: "No email address in AD",
      });
      return;
    }

    const { firstName, lastName } = this.parseDisplayName(adUser.displayName, adUser.username);

    // Find matching local group (first match wins)
    const matchedGroup = groups.find((g) => g.ldapDn && adUser.memberOf.includes(g.ldapDn));
    const groupId = matchedGroup?.id ?? null;

    const existing = localByDn.get(adUser.dn);

    if (existing) {
      await this.updateExistingUser(existing, adUser, { firstName, lastName, groupId }, stats);
    } else {
      await this.createNewUser(adUser, { firstName, lastName, groupId }, appUrl, stats);
    }
  }

  private async updateExistingUser(
    local: {
      id: string;
      username: string;
      email: string;
      firstName: string;
      lastName: string;
      isActive: boolean;
      groupId: string | null;
    },
    adUser: LdapUserEntry,
    parsed: { firstName: string; lastName: string; groupId: string | null },
    stats: SyncStats,
  ): Promise<void> {
    const changes: Record<string, unknown> = {};

    if (local.email !== adUser.email) changes.email = adUser.email;
    if (local.firstName !== parsed.firstName) changes.firstName = parsed.firstName;
    if (local.lastName !== parsed.lastName) changes.lastName = parsed.lastName;
    if (local.groupId !== parsed.groupId) changes.groupId = parsed.groupId;

    // Reactivate if user was deactivated
    if (!local.isActive) {
      changes.isActive = true;
    }

    const isReactivation = changes.isActive === true;
    const hasOtherChanges = Object.keys(changes).filter((k) => k !== "isActive").length > 0;

    if (Object.keys(changes).length === 0) {
      // Nothing changed — skip
      return;
    }

    try {
      await prisma.user.update({
        where: { id: local.id },
        data: changes,
      });

      if (isReactivation) {
        stats.reactivated++;
        getLogger().info({ userId: local.id }, "LDAP: reactivated user");
      }
      if (hasOtherChanges || (!isReactivation && Object.keys(changes).length > 0)) {
        stats.updated++;
        getLogger().info({ userId: local.id }, "LDAP: updated user");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      stats.details.push({ type: "error", username: local.username, message });
    }
  }

  private async createNewUser(
    adUser: LdapUserEntry,
    parsed: { firstName: string; lastName: string; groupId: string | null },
    appUrl: string,
    stats: SyncStats,
  ): Promise<void> {
    // Check for email/username conflicts with non-LDAP accounts
    const conflict = await prisma.user.findUnique({
      where: { email: adUser.email },
    });

    if (conflict && !conflict.ldapDn) {
      // Non-LDAP account already owns this email — skip
      stats.skipped++;
      stats.details.push({
        type: "skip",
        username: adUser.username,
        email: adUser.email,
        message: `Email conflict with existing non-LDAP account (${conflict.username})`,
      });
      return;
    }

    try {
      const newUser = await prisma.user.create({
        data: {
          username: adUser.username,
          email: adUser.email,
          firstName: parsed.firstName,
          lastName: parsed.lastName,
          ldapDn: adUser.dn,
          isActive: true,
          groupId: parsed.groupId,
          password: null,
        },
      });

      stats.created++;
      getLogger().info({ userId: newUser.id, username: newUser.username }, "LDAP: created user");

      // Send welcome email (best-effort)
      await this.sendWelcomeEmail(newUser, appUrl);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      stats.details.push({
        type: "error",
        username: adUser.username,
        email: adUser.email,
        message,
      });
    }
  }

  private async sendWelcomeEmail(
    user: { id: string; email: string },
    appUrl: string,
  ): Promise<void> {
    if (!appUrl) return;

    try {
      // Create a password reset token that doubles as an account activation link
      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      await prisma.passwordReset.create({
        data: {
          userId: user.id,
          token,
          expiresAt,
        },
      });

      const origin = appUrl.replace(/\/$/, "");
      await this.emailService.sendPasswordResetEmail(user.email, token, origin);
    } catch (err) {
      // Non-fatal — log and continue
      getLogger().warn({ userId: user.id, err }, "LDAP: failed to send welcome email (non-fatal)");
    }
  }

  // ── Utilities ──────────────────────────────────────────────────────────────

  /**
   * Split displayName into firstName (first word) and lastName (rest).
   * Falls back to username if displayName is empty.
   */
  parseDisplayName(displayName: string, username: string): { firstName: string; lastName: string } {
    const name = (displayName || username).trim();
    const spaceIdx = name.indexOf(" ");

    if (spaceIdx === -1) {
      return { firstName: name, lastName: "" };
    }

    return {
      firstName: name.slice(0, spaceIdx),
      lastName: name.slice(spaceIdx + 1),
    };
  }
}
