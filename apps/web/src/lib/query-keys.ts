/**
 * Hierarchical query key factory for TanStack Query.
 *
 * Pattern: each domain has an `all` key for broad invalidation
 * and specific keys for granular cache control.
 *
 * Usage:
 *   queryKeys.shares.all          → invalidates ALL share queries
 *   queryKeys.shares.list()       → the user's share list
 *   queryKeys.shares.byAlias("x") → a single share by alias
 */
export const queryKeys = {
  auth: {
    all: ["auth"] as const,
    currentUser: () => [...queryKeys.auth.all, "currentUser"] as const,
    config: () => [...queryKeys.auth.all, "config"] as const,
    providers: {
      all: () => [...queryKeys.auth.all, "providers"] as const,
      enabled: () => [...queryKeys.auth.all, "providers", "enabled"] as const,
    },
    twoFactor: {
      status: () => [...queryKeys.auth.all, "twoFactor", "status"] as const,
      setup: () => [...queryKeys.auth.all, "twoFactor", "setup"] as const,
    },
    trustedDevices: () => [...queryKeys.auth.all, "trustedDevices"] as const,
  },

  files: {
    all: ["files"] as const,
    list: () => [...queryKeys.files.all, "list"] as const,
    embedToken: (fileId: string, shareId: string) =>
      [...queryKeys.files.all, "embedToken", fileId, shareId] as const,
  },

  folders: {
    all: ["folders"] as const,
    list: () => [...queryKeys.folders.all, "list"] as const,
  },

  fileBrowser: {
    all: ["fileBrowser"] as const,
    data: () => [...queryKeys.fileBrowser.all, "data"] as const,
  },

  shares: {
    all: ["shares"] as const,
    list: () => [...queryKeys.shares.all, "list"] as const,
    byAlias: (alias: string) => [...queryKeys.shares.all, "byAlias", alias] as const,
    detail: (id: string) => [...queryKeys.shares.all, "detail", id] as const,
    folderContents: (shareId: string, folderId: string) =>
      [...queryKeys.shares.all, "folderContents", shareId, folderId] as const,
  },

  reverseShares: {
    all: ["reverseShares"] as const,
    list: () => [...queryKeys.reverseShares.all, "list"] as const,
    forUpload: (alias: string) => [...queryKeys.reverseShares.all, "forUpload", alias] as const,
  },

  users: {
    all: ["users"] as const,
    list: () => [...queryKeys.users.all, "list"] as const,
    detail: (id: string) => [...queryKeys.users.all, "detail", id] as const,
    quota: (id: string) => [...queryKeys.users.all, "quota", id] as const,
  },

  groups: {
    all: ["groups"] as const,
    list: () => [...queryKeys.groups.all, "list"] as const,
    detail: (id: string) => [...queryKeys.groups.all, "detail", id] as const,
  },

  config: {
    all: ["config"] as const,
    public: () => [...queryKeys.config.all, "public"] as const,
    admin: () => [...queryKeys.config.all, "admin"] as const,
    value: (key: string) => [...queryKeys.config.all, "value", key] as const,
  },

  app: {
    all: ["app"] as const,
    info: () => [...queryKeys.app.all, "info"] as const,
    diskSpace: () => [...queryKeys.app.all, "diskSpace"] as const,
    health: () => [...queryKeys.app.all, "health"] as const,
    healthStatus: () => [...queryKeys.app.all, "healthStatus"] as const,
    systemInfo: () => [...queryKeys.app.all, "systemInfo"] as const,
  },

  invite: {
    all: ["invite"] as const,
    validate: (token: string) => [...queryKeys.invite.all, "validate", token] as const,
  },

  admin: {
    all: ["admin"] as const,
    stats: () => [...queryKeys.admin.all, "stats"] as const,
    audit: {
      all: () => [...queryKeys.admin.all, "audit"] as const,
      logs: (params: Record<string, unknown>) =>
        [...queryKeys.admin.all, "audit", "logs", params] as const,
    },
  },

  ldap: {
    all: ["ldap"] as const,
    config: () => [...queryKeys.ldap.all, "config"] as const,
    status: () => [...queryKeys.ldap.all, "status"] as const,
    syncLogs: () => [...queryKeys.ldap.all, "syncLogs"] as const,
    syncLogDetail: (id: string) => [...queryKeys.ldap.all, "syncLog", id] as const,
  },

  backgroundImages: {
    all: ["backgroundImages"] as const,
    list: () => [...queryKeys.backgroundImages.all, "list"] as const,
  },
} as const;
