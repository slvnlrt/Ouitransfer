import crypto from "node:crypto";
import { prisma } from "../../shared/prisma.js";
import { ConflictError } from "../../utils/app-error.js";
import { getLogger } from "../../utils/logger.js";
import { hashToken } from "../../utils/token-hash.js";
import { logAuditEvent } from "../audit/service.js";
import { emailService } from "../email/service.js";
import { buildResetPasswordUrl, getAppUrl } from "../email/url-builder.js";
import { assertSafeAppUrl } from "./app-url.js";
import { LdapConfigRepository } from "./config.repository.js";
import { decrypt } from "./encryption.js";
import type { LdapUserEntry } from "./ldap.client.js";
import { LdapClient } from "./ldap.client.js";
import { sanitizeDirectoryEmail, sanitizeDirectoryName } from "./sanitize-directory.js";
import { LdapSyncLogRepository } from "./sync.repository.js";

// ── Types ────────────────────────────────────────────────────────────────────

interface SyncDetail {
  type: "skip" | "error";
  username: string;
  email?: string;
  phase?: string;
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

    let currentPhase = "connect";
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
        tlsSkipVerify: config.tlsSkipVerify,
      });

      currentPhase = "search";
      const adUsers = await this.ldapClient.searchSyncGroupMembers({
        searchBase: config.searchBase,
        syncGroupDn: config.syncGroupDn,
        usernameAttribute: config.usernameAttribute,
        emailAttribute: config.emailAttribute,
        displayNameAttribute: config.displayNameAttribute,
      });

      await this.ldapClient.disconnect();

      currentPhase = "sync";
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

      logAuditEvent({
        action: "LDAP_SYNC_COMPLETED",
        ipAddress: "system",
        targetType: "ldap_sync_log",
        targetId: log.id,
        metadata: {
          trigger,
          status,
          usersCreated: stats.created,
          usersUpdated: stats.updated,
          usersDeactivated: stats.deactivated,
          usersReactivated: stats.reactivated,
          usersSkipped: stats.skipped,
        },
      }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));

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
        details: JSON.stringify([
          { type: "error" as const, username: "", phase: currentPhase, message },
        ]),
      });

      logAuditEvent({
        action: "LDAP_SYNC_ERROR",
        ipAddress: "system",
        targetType: "ldap_sync_log",
        targetId: log.id,
        metadata: { trigger, error: message },
      }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));

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

    // Batch deactivation: find local LDAP users no longer in AD
    const toDeactivate = localLdapUsers.filter(
      (u) => u.isActive && u.ldapDn && !adUserDns.has(u.ldapDn),
    );
    const toDeactivateIds = toDeactivate.map((u) => u.id);

    if (toDeactivateIds.length > 0) {
      await prisma.user.updateMany({
        where: { id: { in: toDeactivateIds } },
        data: { isActive: false },
      });
      stats.deactivated = toDeactivateIds.length;
      for (const u of toDeactivate) {
        getLogger().info({ userId: u.id, username: u.username }, "LDAP: deactivated user");
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

    // Treat directory attribute values as untrusted input (A5-08): strip control
    // and bidi/zero-width characters, cap length, and reject implausible emails
    // before they are persisted (defense-in-depth against stored XSS / spoofing).
    const sanitizedEmail = sanitizeDirectoryEmail(adUser.email);
    if (!sanitizedEmail) {
      stats.skipped++;
      stats.details.push({
        type: "skip",
        username: adUser.username,
        email: adUser.email,
        message: "Invalid email address in AD",
      });
      return;
    }
    // Replace the raw value so every downstream use (conflict lookup, create,
    // update, welcome email) operates on the normalized address.
    adUser.email = sanitizedEmail;

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
      } else {
        stats.updated++;
        getLogger().info({ userId: local.id }, "LDAP: updated user");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      stats.details.push({
        type: "error",
        username: local.username,
        phase: "update-user",
        message,
      });
    }
  }

  private async createNewUser(
    adUser: LdapUserEntry,
    parsed: { firstName: string; lastName: string; groupId: string | null },
    appUrl: string,
    stats: SyncStats,
  ): Promise<void> {
    // Check for email/username conflicts with non-LDAP accounts
    const conflict = await prisma.user.findFirst({
      where: { OR: [{ email: adUser.email }, { username: adUser.username }] },
    });

    if (conflict && conflict.ldapDn !== adUser.dn) {
      // Another account (local or a different LDAP entry) already owns this
      // email or username — skip.
      stats.skipped++;
      const conflictField = conflict.email === adUser.email ? "email" : "username";
      const conflictKind = conflict.ldapDn ? "LDAP" : "non-LDAP";
      stats.details.push({
        type: "skip",
        username: adUser.username,
        email: adUser.email,
        message: `${conflictField.charAt(0).toUpperCase() + conflictField.slice(1)} conflict with existing ${conflictKind} account (${conflict.username})`,
      });
      return;
    }

    try {
      // Atomic: create user + password reset token in a single transaction
      const { newUser, resetToken } = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
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

        let token: string | null = null;
        if (appUrl) {
          const tokenStr = crypto.randomBytes(32).toString("hex");
          await tx.passwordReset.create({
            data: {
              userId: user.id,
              token: hashToken(tokenStr),
              expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
            },
          });
          token = tokenStr;
        }

        return { newUser: user, resetToken: token };
      });

      stats.created++;
      getLogger().info({ userId: newUser.id, username: newUser.username }, "LDAP: created user");

      // Notify admins about new LDAP user (fire-and-forget, non-fatal)
      emailService
        .sendToAdmins("admin_user_registered", {
          userName:
            `${newUser.firstName ?? ""} ${newUser.lastName ?? ""}`.trim() || newUser.username,
          userEmail: newUser.email,
          registrationMethod: "ldap",
        })
        .catch((err) =>
          getLogger().warn(
            { err, userId: newUser.id },
            "LDAP: admin_user_registered notification failed",
          ),
        );

      // Send welcome email outside transaction (non-fatal)
      if (resetToken && appUrl) {
        try {
          // A5-13: the password-set link carries a reset token (a credential).
          // Validate appUrl is a canonical http(s):// origin and warn if it
          // diverges from the application appUrl the email layer actually uses,
          // before building the link.
          const configuredAppUrl = await getAppUrl().catch(() => undefined);
          assertSafeAppUrl(appUrl, configuredAppUrl);
          const setPasswordUrl = await buildResetPasswordUrl(resetToken);
          await emailService.send("welcome", {
            to: newUser.email,
            locale: newUser.locale ?? "en",
            userId: newUser.id,
            data: {
              firstName: newUser.firstName ?? newUser.username,
              loginUrl: setPasswordUrl,
            },
          });
        } catch (err) {
          stats.details.push({
            type: "skip",
            username: adUser.username,
            email: adUser.email,
            phase: "welcome-email",
            message: "Welcome email failed (user created successfully)",
          });
          getLogger().warn({ userId: newUser.id, err }, "LDAP: failed to send welcome email");
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      stats.details.push({
        type: "error",
        username: adUser.username,
        email: adUser.email,
        phase: "create-user",
        message,
      });
    }
  }

  // ── Utilities ──────────────────────────────────────────────────────────────

  /**
   * Split displayName into firstName (first word) and lastName (rest).
   * Handles "Last, First" format (common in Active Directory).
   * Falls back to username if displayName is empty.
   */
  parseDisplayName(displayName: string, username: string): { firstName: string; lastName: string } {
    // Sanitize directory-sourced names on ingest (A5-08): strip control and
    // bidi/zero-width characters and cap length before they are persisted.
    const name = sanitizeDirectoryName(displayName) || sanitizeDirectoryName(username);

    // Handle "Last, First" format (common in AD)
    const commaIdx = name.indexOf(", ");
    if (commaIdx !== -1) {
      return {
        firstName: sanitizeDirectoryName(name.slice(commaIdx + 2)),
        lastName: sanitizeDirectoryName(name.slice(0, commaIdx)),
      };
    }

    const spaceIdx = name.indexOf(" ");

    if (spaceIdx === -1) {
      return { firstName: name, lastName: "" };
    }

    return {
      firstName: sanitizeDirectoryName(name.slice(0, spaceIdx)),
      lastName: sanitizeDirectoryName(name.slice(spaceIdx + 1)),
    };
  }
}
