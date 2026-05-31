import { beforeEach, describe, expect, it, vi } from "vitest";

// ── All vi.mock() calls MUST be before any imports ──

vi.mock("../../../shared/prisma.js", () => ({
  prisma: {
    user: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    group: {
      findMany: vi.fn(),
    },
    passwordReset: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("../config.repository.js", () => ({
  // biome-ignore lint/suspicious/noExplicitAny: vi mock constructor
  LdapConfigRepository: vi.fn().mockImplementation(function (this: any) {
    this.get = vi.fn();
  }),
}));

vi.mock("../sync.repository.js", () => ({
  // biome-ignore lint/suspicious/noExplicitAny: vi mock constructor
  LdapSyncLogRepository: vi.fn().mockImplementation(function (this: any) {
    this.create = vi.fn();
    this.complete = vi.fn();
  }),
}));

vi.mock("../ldap.client.js", () => ({
  // biome-ignore lint/suspicious/noExplicitAny: vi mock constructor
  LdapClient: vi.fn().mockImplementation(function (this: any) {
    this.connect = vi.fn();
    this.searchSyncGroupMembers = vi.fn();
    this.disconnect = vi.fn();
  }),
}));

vi.mock("../encryption.js", () => ({
  decrypt: vi.fn().mockReturnValue("plaintext-password"),
}));

vi.mock("../../email/service.js", () => ({
  emailService: {
    send: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../../utils/token-hash.js", () => ({
  hashToken: vi.fn((token: string) => `hashed-${token}`),
}));

vi.mock("../../config/service.js", () => ({
  getConfigValue: vi.fn(),
}));

vi.mock("../../../utils/logger.js", () => ({
  getLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ── Now we can import the mocked modules ──
import { prisma } from "../../../shared/prisma.js";
import { ConflictError } from "../../../utils/app-error.js";
import { LdapConfigRepository } from "../config.repository.js";
import { LdapClient } from "../ldap.client.js";
import { LdapSyncLogRepository } from "../sync.repository.js";

// Import the module under test
import { LdapSyncService } from "../sync.service.js";

// ── Default fixtures ──────────────────────────────────────────────────────────

const defaultConfig = {
  id: "config-1",
  enabled: true,
  serverUrl: "ldaps://ad.corp.local:636",
  bindDn: "cn=svc,dc=corp,dc=local",
  bindPassword: "encrypted-password",
  searchBase: "DC=corp,DC=local",
  syncGroupDn: "CN=OuiTransfer,OU=Groups,DC=corp,DC=local",
  usernameAttribute: "sAMAccountName",
  emailAttribute: "mail",
  displayNameAttribute: "displayName",
  syncIntervalMinutes: 360,
  useTls: true,
  tlsSkipVerify: false,
  appUrl: "https://transfer.corp.local",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const defaultLog = {
  id: "log-1",
  trigger: "manual",
  status: "running",
  startedAt: new Date(),
  completedAt: null,
  usersCreated: 0,
  usersUpdated: 0,
  usersDeactivated: 0,
  usersSkipped: 0,
  usersReactivated: 0,
  details: null,
  createdAt: new Date(),
};

// ── Helper: get mock instances ────────────────────────────────────────────────
// Each time `new LdapSyncService()` is created, new instances of the mocked
// classes are constructed. We grab the latest instance.

// biome-ignore lint/suspicious/noExplicitAny: test helpers
function latestInstance(MockClass: { mock: { instances: any[] } }) {
  const { instances } = MockClass.mock;
  return instances[instances.length - 1];
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe("LdapSyncService", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Re-apply default return values for prisma mocks after clearAllMocks
    vi.mocked(prisma.group.findMany).mockResolvedValue([]);
    vi.mocked(prisma.user.findMany).mockResolvedValue([]);
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.user.updateMany).mockResolvedValue({ count: 0 });
    // $transaction: by default, execute the callback with prisma as tx
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      if (typeof fn === "function") {
        return fn(prisma);
      }
      // Array-style transactions
      return Promise.all(fn);
    });
    vi.mocked(prisma.passwordReset.create).mockResolvedValue({
      id: "pr-1",
      userId: "u-1",
      token: "token-abc",
      expiresAt: new Date(),
      used: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  // Helper: create a service and wire up the freshly-constructed mock instances
  function makeService(adUsers: object[] = [], config = defaultConfig) {
    const service = new LdapSyncService();

    const configRepo = latestInstance(vi.mocked(LdapConfigRepository));
    const syncRepo = latestInstance(vi.mocked(LdapSyncLogRepository));
    const ldapClient = latestInstance(vi.mocked(LdapClient));

    vi.mocked(configRepo.get).mockResolvedValue(config);
    vi.mocked(syncRepo.create).mockResolvedValue(defaultLog);
    vi.mocked(syncRepo.complete).mockResolvedValue({ ...defaultLog, status: "success" });
    vi.mocked(ldapClient.connect).mockResolvedValue(undefined);
    vi.mocked(ldapClient.searchSyncGroupMembers).mockResolvedValue(adUsers);
    vi.mocked(ldapClient.disconnect).mockResolvedValue(undefined);

    return { service, configRepo, syncRepo, ldapClient };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // 1. Mutex: throw ConflictError if sync already in progress
  // ────────────────────────────────────────────────────────────────────────────
  it("should throw ConflictError if sync already in progress", async () => {
    const service = new LdapSyncService();

    const configRepo = latestInstance(vi.mocked(LdapConfigRepository));
    const syncRepo = latestInstance(vi.mocked(LdapSyncLogRepository));
    const ldapClient = latestInstance(vi.mocked(LdapClient));

    vi.mocked(configRepo.get).mockResolvedValue(defaultConfig);
    vi.mocked(ldapClient.connect).mockResolvedValue(undefined);
    vi.mocked(ldapClient.searchSyncGroupMembers).mockResolvedValue([]);
    vi.mocked(ldapClient.disconnect).mockResolvedValue(undefined);

    // The first sync will block indefinitely at syncRepo.create
    let resolveFirst!: (value: typeof defaultLog) => void;
    const blocker = new Promise<typeof defaultLog>((resolve) => {
      resolveFirst = resolve;
    });
    vi.mocked(syncRepo.create).mockReturnValue(blocker);

    // Start first sync without awaiting — it hangs at syncRepo.create
    const firstSync = service.runSync("manual");

    // Give the event loop a tick so firstSync advances past the mutex check
    await new Promise((r) => setTimeout(r, 0));

    // A second call must throw immediately
    try {
      await expect(service.runSync("manual")).rejects.toThrow(ConflictError);
    } finally {
      // Always unblock the first sync so the finally block resets the mutex
      vi.mocked(syncRepo.complete).mockResolvedValue({ ...defaultLog, status: "success" });
      resolveFirst(defaultLog);
      await firstSync.catch(() => {});
    }
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 2. Create new users from AD
  // ────────────────────────────────────────────────────────────────────────────
  it("should create new users from AD", async () => {
    const adUser = {
      dn: "CN=jdoe,OU=Users,DC=corp,DC=local",
      username: "jdoe",
      email: "jdoe@corp.local",
      displayName: "John Doe",
      memberOf: [],
    };

    const newUserRecord = {
      id: "new-user-1",
      firstName: "John",
      lastName: "Doe",
      username: "jdoe",
      email: "jdoe@corp.local",
      ldapDn: adUser.dn,
      isActive: true,
      isAdmin: false,
      groupId: null,
      password: null,
      image: null,
      twoFactorEnabled: false,
      twoFactorSecret: null,
      twoFactorBackupCodes: null,
      twoFactorVerified: false,
      maxFileSizeOverride: null,
      maxTotalStorageOverride: null,
      tokenVersion: 0,
      locale: "en",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const { service, syncRepo } = makeService([adUser]);

    vi.mocked(prisma.user.findMany).mockResolvedValue([]);
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockResolvedValue(newUserRecord);

    // $transaction callback returns the created user and token
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      if (typeof fn === "function") {
        return fn(prisma);
      }
      return Promise.all(fn);
    });

    await service.runSync("manual");

    expect(vi.mocked(prisma.user.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          username: "jdoe",
          email: "jdoe@corp.local",
          firstName: "John",
          lastName: "Doe",
          ldapDn: adUser.dn,
          isActive: true,
        }),
      }),
    );
    // TD-39: verify the reset token is stored as a SHA-256 hash, never plaintext
    expect(vi.mocked(prisma.passwordReset.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          token: expect.stringMatching(/^hashed-/),
        }),
      }),
    );
    expect(vi.mocked(syncRepo.complete)).toHaveBeenCalledWith(
      "log-1",
      expect.objectContaining({ usersCreated: 1 }),
    );
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 3. Skip users with email conflict (non-LDAP account)
  // ────────────────────────────────────────────────────────────────────────────
  it("should skip users with email conflict (non-LDAP account)", async () => {
    const adUser = {
      dn: "CN=jdoe,OU=Users,DC=corp,DC=local",
      username: "jdoe",
      email: "jdoe@corp.local",
      displayName: "John Doe",
      memberOf: [],
    };

    const { service, syncRepo } = makeService([adUser]);

    vi.mocked(prisma.user.findMany).mockResolvedValue([]);
    // Email already taken by a non-LDAP account (findFirst now used for OR query)
    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      id: "local-user-1",
      username: "jdoe",
      email: "jdoe@corp.local",
      ldapDn: null, // non-LDAP account
      firstName: "John",
      lastName: "Doe",
      isActive: true,
      isAdmin: false,
      password: "hashed",
      image: null,
      groupId: null,
      twoFactorEnabled: false,
      twoFactorSecret: null,
      twoFactorBackupCodes: null,
      twoFactorVerified: false,
      maxFileSizeOverride: null,
      maxTotalStorageOverride: null,
      tokenVersion: 0,
      locale: "en",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await service.runSync("manual");

    expect(vi.mocked(prisma.user.create)).not.toHaveBeenCalled();
    expect(vi.mocked(syncRepo.complete)).toHaveBeenCalledWith(
      "log-1",
      expect.objectContaining({ usersSkipped: 1 }),
    );
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 4. Update existing LDAP user when attributes change
  // ────────────────────────────────────────────────────────────────────────────
  it("should update existing LDAP user when attributes change", async () => {
    const dn = "CN=jdoe,OU=Users,DC=corp,DC=local";
    const adUser = {
      dn,
      username: "jdoe",
      email: "jdoe.new@corp.local", // email changed
      displayName: "John Doe",
      memberOf: [],
    };

    const existingLocalUser = {
      id: "user-1",
      username: "jdoe",
      email: "jdoe.old@corp.local",
      ldapDn: dn,
      firstName: "John",
      lastName: "Doe",
      isActive: true,
      isAdmin: false,
      password: null,
      image: null,
      groupId: null,
      twoFactorEnabled: false,
      twoFactorSecret: null,
      twoFactorBackupCodes: null,
      twoFactorVerified: false,
      maxFileSizeOverride: null,
      maxTotalStorageOverride: null,
      tokenVersion: 0,
      locale: "en",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const { service, syncRepo } = makeService([adUser]);

    vi.mocked(prisma.user.findMany).mockResolvedValue([existingLocalUser]);
    vi.mocked(prisma.user.update).mockResolvedValue({
      ...existingLocalUser,
      email: adUser.email,
    });

    await service.runSync("manual");

    expect(vi.mocked(prisma.user.update)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-1" },
        data: expect.objectContaining({ email: "jdoe.new@corp.local" }),
      }),
    );
    expect(vi.mocked(syncRepo.complete)).toHaveBeenCalledWith(
      "log-1",
      expect.objectContaining({ usersUpdated: 1 }),
    );
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 5. Deactivate local LDAP user not found in AD (batch)
  // ────────────────────────────────────────────────────────────────────────────
  it("should deactivate local LDAP user not found in AD", async () => {
    // AD returns no users
    const { service, syncRepo } = makeService([]);

    const activeLocalLdapUser = {
      id: "user-1",
      username: "jdoe",
      email: "jdoe@corp.local",
      ldapDn: "CN=jdoe,OU=Users,DC=corp,DC=local",
      firstName: "John",
      lastName: "Doe",
      isActive: true,
      isAdmin: false,
      password: null,
      image: null,
      groupId: null,
      twoFactorEnabled: false,
      twoFactorSecret: null,
      twoFactorBackupCodes: null,
      twoFactorVerified: false,
      maxFileSizeOverride: null,
      maxTotalStorageOverride: null,
      tokenVersion: 0,
      locale: "en",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(prisma.user.findMany).mockResolvedValue([activeLocalLdapUser]);
    vi.mocked(prisma.user.updateMany).mockResolvedValue({ count: 1 });

    await service.runSync("manual");

    expect(vi.mocked(prisma.user.updateMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["user-1"] } },
        data: expect.objectContaining({ isActive: false }),
      }),
    );
    expect(vi.mocked(syncRepo.complete)).toHaveBeenCalledWith(
      "log-1",
      expect.objectContaining({ usersDeactivated: 1 }),
    );
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 6. Reactivate deactivated LDAP user back in AD
  // ────────────────────────────────────────────────────────────────────────────
  it("should reactivate deactivated LDAP user back in AD", async () => {
    const dn = "CN=jdoe,OU=Users,DC=corp,DC=local";
    const adUser = {
      dn,
      username: "jdoe",
      email: "jdoe@corp.local",
      displayName: "John Doe",
      memberOf: [],
    };

    const inactiveLdapUser = {
      id: "user-1",
      username: "jdoe",
      email: "jdoe@corp.local",
      ldapDn: dn,
      firstName: "John",
      lastName: "Doe",
      isActive: false, // deactivated
      isAdmin: false,
      password: null,
      image: null,
      groupId: null,
      twoFactorEnabled: false,
      twoFactorSecret: null,
      twoFactorBackupCodes: null,
      twoFactorVerified: false,
      maxFileSizeOverride: null,
      maxTotalStorageOverride: null,
      tokenVersion: 0,
      locale: "en",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const { service, syncRepo } = makeService([adUser]);

    vi.mocked(prisma.user.findMany).mockResolvedValue([inactiveLdapUser]);
    vi.mocked(prisma.user.update).mockResolvedValue({
      ...inactiveLdapUser,
      isActive: true,
    });

    await service.runSync("manual");

    expect(vi.mocked(prisma.user.update)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-1" },
        data: expect.objectContaining({ isActive: true }),
      }),
    );
    expect(vi.mocked(syncRepo.complete)).toHaveBeenCalledWith(
      "log-1",
      expect.objectContaining({ usersReactivated: 1 }),
    );
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 7. Map AD group to local group (first match wins)
  // ────────────────────────────────────────────────────────────────────────────
  it("should map AD group to local group (first match wins)", async () => {
    const groupDn1 = "CN=GroupA,OU=Groups,DC=corp,DC=local";
    const groupDn2 = "CN=GroupB,OU=Groups,DC=corp,DC=local";

    const adUser = {
      dn: "CN=jdoe,OU=Users,DC=corp,DC=local",
      username: "jdoe",
      email: "jdoe@corp.local",
      displayName: "John Doe",
      memberOf: [groupDn1, groupDn2],
    };

    const newUserRecord = {
      id: "new-user-1",
      username: "jdoe",
      email: "jdoe@corp.local",
      firstName: "John",
      lastName: "Doe",
      ldapDn: adUser.dn,
      groupId: "group-a-id",
      isActive: true,
      isAdmin: false,
      password: null,
      image: null,
      twoFactorEnabled: false,
      twoFactorSecret: null,
      twoFactorBackupCodes: null,
      twoFactorVerified: false,
      maxFileSizeOverride: null,
      maxTotalStorageOverride: null,
      tokenVersion: 0,
      locale: "en",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const { service } = makeService([adUser]);

    vi.mocked(prisma.user.findMany).mockResolvedValue([]);
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockResolvedValue(newUserRecord);

    // Two groups with ldapDn — first match in memberOf should win
    vi.mocked(prisma.group.findMany).mockResolvedValue([
      {
        id: "group-a-id",
        name: "GroupA",
        description: null,
        ldapDn: groupDn1,
        maxFileSizeOverride: null,
        maxTotalStorageOverride: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "group-b-id",
        name: "GroupB",
        description: null,
        ldapDn: groupDn2,
        maxFileSizeOverride: null,
        maxTotalStorageOverride: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    await service.runSync("manual");

    expect(vi.mocked(prisma.user.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          groupId: "group-a-id",
        }),
      }),
    );
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 8. Skip users without email
  // ────────────────────────────────────────────────────────────────────────────
  it("should skip users without email", async () => {
    const adUser = {
      dn: "CN=jdoe,OU=Users,DC=corp,DC=local",
      username: "jdoe",
      email: "", // no email
      displayName: "John Doe",
      memberOf: [],
    };

    const { service, syncRepo } = makeService([adUser]);

    vi.mocked(prisma.user.findMany).mockResolvedValue([]);

    await service.runSync("manual");

    expect(vi.mocked(prisma.user.create)).not.toHaveBeenCalled();
    expect(vi.mocked(syncRepo.complete)).toHaveBeenCalledWith(
      "log-1",
      expect.objectContaining({ usersSkipped: 1 }),
    );
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 9. Parse display name: "Jean Pierre Dupont" → firstName: "Jean", lastName: "Pierre Dupont"
  // ────────────────────────────────────────────────────────────────────────────
  it("should parse display name into first and last name", async () => {
    const adUser = {
      dn: "CN=jpdupont,OU=Users,DC=corp,DC=local",
      username: "jpdupont",
      email: "jpdupont@corp.local",
      displayName: "Jean Pierre Dupont",
      memberOf: [],
    };

    const { service } = makeService([adUser]);

    vi.mocked(prisma.user.findMany).mockResolvedValue([]);
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockResolvedValue({
      id: "new-1",
      username: "jpdupont",
      email: "jpdupont@corp.local",
      firstName: "Jean",
      lastName: "Pierre Dupont",
      ldapDn: adUser.dn,
      groupId: null,
      isActive: true,
      isAdmin: false,
      password: null,
      image: null,
      twoFactorEnabled: false,
      twoFactorSecret: null,
      twoFactorBackupCodes: null,
      twoFactorVerified: false,
      maxFileSizeOverride: null,
      maxTotalStorageOverride: null,
      tokenVersion: 0,
      locale: "en",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await service.runSync("manual");

    expect(vi.mocked(prisma.user.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          firstName: "Jean",
          lastName: "Pierre Dupont",
        }),
      }),
    );
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 10. No update if nothing changed
  // ────────────────────────────────────────────────────────────────────────────
  it("should not update user if nothing changed", async () => {
    const dn = "CN=jdoe,OU=Users,DC=corp,DC=local";
    const adUser = {
      dn,
      username: "jdoe",
      email: "jdoe@corp.local",
      displayName: "John Doe",
      memberOf: [],
    };

    // Local user exactly matches AD
    const localUser = {
      id: "user-1",
      username: "jdoe",
      email: "jdoe@corp.local",
      ldapDn: dn,
      firstName: "John",
      lastName: "Doe",
      isActive: true,
      groupId: null,
      isAdmin: false,
      password: null,
      image: null,
      twoFactorEnabled: false,
      twoFactorSecret: null,
      twoFactorBackupCodes: null,
      twoFactorVerified: false,
      maxFileSizeOverride: null,
      maxTotalStorageOverride: null,
      tokenVersion: 0,
      locale: "en",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const { service, syncRepo } = makeService([adUser]);

    vi.mocked(prisma.user.findMany).mockResolvedValue([localUser]);

    await service.runSync("manual");

    expect(vi.mocked(prisma.user.update)).not.toHaveBeenCalled();
    expect(vi.mocked(syncRepo.complete)).toHaveBeenCalledWith(
      "log-1",
      expect.objectContaining({ usersUpdated: 0, usersCreated: 0 }),
    );
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 11. isSyncInProgress() returns false when idle
  // ────────────────────────────────────────────────────────────────────────────
  it("isSyncInProgress() should return false when no sync running", () => {
    const service = new LdapSyncService();
    expect(service.isSyncInProgress()).toBe(false);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 12. Parse "Last, First" display name format (M6)
  // ────────────────────────────────────────────────────────────────────────────
  it("should parse 'Last, First' display name format", () => {
    const service = new LdapSyncService();
    const result = service.parseDisplayName("Dupont, Jean", "jdupont");
    expect(result).toEqual({ firstName: "Jean", lastName: "Dupont" });
  });
});
