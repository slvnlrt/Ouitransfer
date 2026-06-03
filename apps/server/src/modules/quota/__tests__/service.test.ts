import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../shared/prisma.js", () => ({
  prisma: {
    file: { aggregate: vi.fn() },
    reverseShareFile: { aggregate: vi.fn() },
    user: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("../../config/service.js", () => ({
  getConfigValue: vi.fn(),
}));

vi.mock("../../email/service.js", () => ({
  emailService: {
    send: vi.fn().mockResolvedValue({ enqueued: true }),
    sendToAdmins: vi.fn().mockResolvedValue({ enqueued: true }),
  },
}));

vi.mock("../../../utils/logger.js", () => ({
  setLogger: vi.fn(),
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { prisma } from "../../../shared/prisma.js";
import { NotFoundError } from "../../../utils/app-error.js";
import { getConfigValue } from "../../config/service.js";
import { emailService } from "../../email/service.js";
import { QuotaRepository } from "../repository.js";
import { QuotaService } from "../service.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeAgg(size: bigint) {
  return {
    _sum: { size },
    _count: 0,
    _avg: {},
    _min: {},
    _max: {},
  } as never;
}

const GLOBAL_MAX_FILE_SIZE = 1_073_741_824n; // 1 GiB
const GLOBAL_MAX_TOTAL_STORAGE = 10_737_418_240n; // 10 GiB

function setupGlobalDefaults() {
  vi.mocked(getConfigValue).mockImplementation(async (key: string) => {
    if (key === "maxFileSize") return "1073741824";
    if (key === "maxTotalStoragePerUser") return "10737418240";
    throw new Error(`Unknown config key: ${key}`);
  });
}

// ─── QuotaRepository ────────────────────────────────────────────────────────

describe("QuotaRepository", () => {
  let repository: QuotaRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = new QuotaRepository();
  });

  it("sums File.size and ReverseShareFile.size for a user", async () => {
    vi.mocked(prisma.file.aggregate).mockResolvedValue(makeAgg(500n));
    vi.mocked(prisma.reverseShareFile.aggregate).mockResolvedValue(makeAgg(300n));

    const result = await repository.calculateStorageUsed("user-1");

    expect(result).toBe(800n);
    expect(prisma.file.aggregate).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      _sum: { size: true },
    });
    expect(prisma.reverseShareFile.aggregate).toHaveBeenCalledWith({
      where: { reverseShare: { creatorId: "user-1" } },
      _sum: { size: true },
    });
  });

  it("returns 0n when user has no files", async () => {
    vi.mocked(prisma.file.aggregate).mockResolvedValue(makeAgg(0n));
    vi.mocked(prisma.reverseShareFile.aggregate).mockResolvedValue({
      _sum: { size: null },
      _count: 0,
      _avg: {},
      _min: {},
      _max: {},
    } as never);

    const result = await repository.calculateStorageUsed("user-empty");

    expect(result).toBe(0n);
    expect(prisma.file.aggregate).toHaveBeenCalledWith({
      _sum: { size: true },
      where: { userId: "user-empty" },
    });
  });

  it("counts only ReverseShareFiles owned by user via ReverseShare.creatorId", async () => {
    vi.mocked(prisma.file.aggregate).mockResolvedValue(makeAgg(0n));
    vi.mocked(prisma.reverseShareFile.aggregate).mockResolvedValue(makeAgg(1_000_000n));

    await repository.calculateStorageUsed("user-1");

    // Verify the filter goes through the reverseShare relation
    expect(prisma.reverseShareFile.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { reverseShare: { creatorId: "user-1" } },
      }),
    );
  });
});

// ─── QuotaService.resolveEffectiveLimits ────────────────────────────────────

describe("QuotaService.resolveEffectiveLimits", () => {
  let service: QuotaService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new QuotaService();
    setupGlobalDefaults();
  });

  it("returns global defaults for regular user with no overrides", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      isAdmin: false,
      maxFileSizeOverride: null,
      maxTotalStorageOverride: null,
      group: null,
    } as never);

    const limits = await service.resolveEffectiveLimits("user-1");

    expect(limits.maxFileSize).toBe(GLOBAL_MAX_FILE_SIZE);
    expect(limits.maxTotalStorage).toBe(GLOBAL_MAX_TOTAL_STORAGE);
    expect(limits.sources).toEqual({
      maxFileSizeSource: "global",
      maxTotalStorageSource: "global",
      groupName: null,
    });
    expect(getConfigValue).toHaveBeenCalledWith("maxFileSize");
    expect(getConfigValue).toHaveBeenCalledWith("maxTotalStoragePerUser");
  });

  it("returns unlimited (0n) for admin with no overrides", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      isAdmin: true,
      maxFileSizeOverride: null,
      maxTotalStorageOverride: null,
      group: null,
    } as never);

    const limits = await service.resolveEffectiveLimits("admin-1");

    expect(limits.maxFileSize).toBe(0n);
    expect(limits.maxTotalStorage).toBe(0n);
    expect(limits.sources).toEqual({
      maxFileSizeSource: "admin-default",
      maxTotalStorageSource: "admin-default",
      groupName: null,
    });
    // Global defaults should NOT be called for admins with no override
    expect(getConfigValue).not.toHaveBeenCalled();
  });

  it("respects per-user override for regular user", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      isAdmin: false,
      maxFileSizeOverride: 524_288_000n, // 500 MiB
      maxTotalStorageOverride: 2_147_483_648n, // 2 GiB
      group: null,
    } as never);

    const limits = await service.resolveEffectiveLimits("user-1");

    expect(limits.maxFileSize).toBe(524_288_000n);
    expect(limits.maxTotalStorage).toBe(2_147_483_648n);
    expect(limits.sources).toEqual({
      maxFileSizeSource: "user",
      maxTotalStorageSource: "user",
      groupName: null,
    });
    expect(getConfigValue).not.toHaveBeenCalled();
  });

  it("respects per-user override for admin (can restrict admin)", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      isAdmin: true,
      maxFileSizeOverride: 104_857_600n, // 100 MiB (restricted)
      maxTotalStorageOverride: 5_368_709_120n, // 5 GiB (restricted)
      group: null,
    } as never);

    const limits = await service.resolveEffectiveLimits("admin-1");

    expect(limits.maxFileSize).toBe(104_857_600n);
    expect(limits.maxTotalStorage).toBe(5_368_709_120n);
    expect(limits.sources).toEqual({
      maxFileSizeSource: "user",
      maxTotalStorageSource: "user",
      groupName: null,
    });
    expect(getConfigValue).not.toHaveBeenCalled();
  });

  it("treats override value 0 as unlimited", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      isAdmin: false,
      maxFileSizeOverride: 0n,
      maxTotalStorageOverride: 0n,
      group: null,
    } as never);

    const limits = await service.resolveEffectiveLimits("user-1");

    expect(limits.maxFileSize).toBe(0n);
    expect(limits.maxTotalStorage).toBe(0n);
    expect(limits.sources).toEqual({
      maxFileSizeSource: "user",
      maxTotalStorageSource: "user",
      groupName: null,
    });
    // Override is explicitly 0n (falsy in JS but not null) — should NOT fall through to global
    expect(getConfigValue).not.toHaveBeenCalled();
  });

  it("allows partial overrides (one null, one set)", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      isAdmin: false,
      maxFileSizeOverride: 209_715_200n, // 200 MiB override
      maxTotalStorageOverride: null, // inherit global
      group: null,
    } as never);

    const limits = await service.resolveEffectiveLimits("user-1");

    expect(limits.maxFileSize).toBe(209_715_200n);
    expect(limits.maxTotalStorage).toBe(GLOBAL_MAX_TOTAL_STORAGE);
    expect(limits.sources.maxFileSizeSource).toBe("user");
    expect(limits.sources.maxTotalStorageSource).toBe("global");
    // Only maxTotalStoragePerUser should be fetched
    expect(getConfigValue).toHaveBeenCalledWith("maxTotalStoragePerUser");
    expect(getConfigValue).not.toHaveBeenCalledWith("maxFileSize");
  });

  it("resolves group overrides when user has no per-user overrides", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      isAdmin: false,
      maxFileSizeOverride: null,
      maxTotalStorageOverride: null,
      group: {
        name: "Engineering",
        maxFileSizeOverride: 2_147_483_648n, // 2 GiB
        maxTotalStorageOverride: 53_687_091_200n, // 50 GiB
      },
    } as never);

    const limits = await service.resolveEffectiveLimits("user-1");

    expect(limits.maxFileSize).toBe(2_147_483_648n);
    expect(limits.maxTotalStorage).toBe(53_687_091_200n);
    expect(limits.sources).toEqual({
      maxFileSizeSource: "group",
      maxTotalStorageSource: "group",
      groupName: "Engineering",
    });
    expect(getConfigValue).not.toHaveBeenCalled();
  });

  it("user override takes precedence over group override", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      isAdmin: false,
      maxFileSizeOverride: 524_288_000n, // 500 MiB (user)
      maxTotalStorageOverride: null, // inherit from group
      group: {
        name: "Engineering",
        maxFileSizeOverride: 2_147_483_648n, // 2 GiB (group — ignored)
        maxTotalStorageOverride: 53_687_091_200n, // 50 GiB (group — used)
      },
    } as never);

    const limits = await service.resolveEffectiveLimits("user-1");

    expect(limits.maxFileSize).toBe(524_288_000n); // user override wins
    expect(limits.maxTotalStorage).toBe(53_687_091_200n); // group override
    expect(limits.sources).toEqual({
      maxFileSizeSource: "user",
      maxTotalStorageSource: "group",
      groupName: "Engineering",
    });
    expect(getConfigValue).not.toHaveBeenCalled();
  });

  it("falls through to global when group has no override", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      isAdmin: false,
      maxFileSizeOverride: null,
      maxTotalStorageOverride: null,
      group: {
        name: "Interns",
        maxFileSizeOverride: null, // no group override
        maxTotalStorageOverride: null, // no group override
      },
    } as never);

    const limits = await service.resolveEffectiveLimits("user-1");

    expect(limits.maxFileSize).toBe(GLOBAL_MAX_FILE_SIZE);
    expect(limits.maxTotalStorage).toBe(GLOBAL_MAX_TOTAL_STORAGE);
    expect(limits.sources).toEqual({
      maxFileSizeSource: "global",
      maxTotalStorageSource: "global",
      groupName: "Interns",
    });
    expect(getConfigValue).toHaveBeenCalledWith("maxFileSize");
    expect(getConfigValue).toHaveBeenCalledWith("maxTotalStoragePerUser");
  });

  it("group override 0n means unlimited (does NOT fall through)", async () => {
    setupGlobalDefaults();
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      isAdmin: false,
      maxFileSizeOverride: null,
      maxTotalStorageOverride: null,
      group: {
        name: "Unlimited Group",
        maxFileSizeOverride: 0n,
        maxTotalStorageOverride: 0n,
      },
    } as never);

    const limits = await service.resolveEffectiveLimits("user-1");
    expect(limits.maxFileSize).toBe(0n); // unlimited
    expect(limits.maxTotalStorage).toBe(0n); // unlimited
    expect(limits.sources.maxFileSizeSource).toBe("group");
    expect(limits.sources.maxTotalStorageSource).toBe("group");
    expect(limits.sources.groupName).toBe("Unlimited Group");
    expect(getConfigValue).not.toHaveBeenCalled();
  });

  it("admin in group uses group override (not admin-default)", async () => {
    setupGlobalDefaults();
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      isAdmin: true,
      maxFileSizeOverride: null,
      maxTotalStorageOverride: null,
      group: {
        name: "Restricted Admins",
        maxFileSizeOverride: 500_000_000n,
        maxTotalStorageOverride: 5_000_000_000n,
      },
    } as never);

    const limits = await service.resolveEffectiveLimits("user-1");
    // Group override should be used even for admins (it's not null, so ?? doesn't trigger)
    expect(limits.maxFileSize).toBe(500_000_000n);
    expect(limits.maxTotalStorage).toBe(5_000_000_000n);
    expect(limits.sources.maxFileSizeSource).toBe("group");
    expect(limits.sources.maxTotalStorageSource).toBe("group");
  });

  it("admin with no overrides and no group gets unlimited", async () => {
    setupGlobalDefaults();
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      isAdmin: true,
      maxFileSizeOverride: null,
      maxTotalStorageOverride: null,
      group: null,
    } as never);

    const limits = await service.resolveEffectiveLimits("user-1");
    expect(limits.maxFileSize).toBe(0n);
    expect(limits.maxTotalStorage).toBe(0n);
    expect(limits.sources.maxFileSizeSource).toBe("admin-default");
    expect(limits.sources.maxTotalStorageSource).toBe("admin-default");
  });

  it("user with no group and no overrides falls through to global", async () => {
    setupGlobalDefaults();
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      isAdmin: false,
      maxFileSizeOverride: null,
      maxTotalStorageOverride: null,
      group: null,
    } as never);

    const limits = await service.resolveEffectiveLimits("user-1");
    expect(limits.maxFileSize).toBe(GLOBAL_MAX_FILE_SIZE);
    expect(limits.maxTotalStorage).toBe(GLOBAL_MAX_TOTAL_STORAGE);
    expect(limits.sources.maxFileSizeSource).toBe("global");
    expect(limits.sources.maxTotalStorageSource).toBe("global");
    expect(limits.sources.groupName).toBeNull();
  });

  it("throws NotFoundError for non-existent user", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    await expect(service.resolveEffectiveLimits("ghost-user")).rejects.toThrow(NotFoundError);
    await expect(service.resolveEffectiveLimits("ghost-user")).rejects.toThrow("User not found");
  });
});

// ─── QuotaService.getQuotaStatus ────────────────────────────────────────────

describe("QuotaService.getQuotaStatus", () => {
  let service: QuotaService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new QuotaService();
    setupGlobalDefaults();

    // Default user: regular, no overrides, no group
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      isAdmin: false,
      maxFileSizeOverride: null,
      maxTotalStorageOverride: null,
      group: null,
    } as never);
  });

  it("returns correct percentage and 'none' warning for low usage", async () => {
    // 5 GiB used of 10 GiB = 50%
    const used = 5_368_709_120n;
    vi.mocked(prisma.file.aggregate).mockResolvedValue(makeAgg(used));
    vi.mocked(prisma.reverseShareFile.aggregate).mockResolvedValue(makeAgg(0n));

    const status = await service.getQuotaStatus("user-1");

    expect(status.used).toBe(used);
    expect(status.maxTotalStorage).toBe(GLOBAL_MAX_TOTAL_STORAGE);
    expect(status.percentage).toBe(50);
    expect(status.warningLevel).toBe("none");
    expect(status.uploadAllowed).toBe(true);
  });

  it("returns 'warning' at 80%", async () => {
    // 8 GiB used of 10 GiB = 80%
    const used = 8_589_934_592n;
    vi.mocked(prisma.file.aggregate).mockResolvedValue(makeAgg(used));
    vi.mocked(prisma.reverseShareFile.aggregate).mockResolvedValue(makeAgg(0n));

    const status = await service.getQuotaStatus("user-1");

    expect(status.percentage).toBe(80);
    expect(status.warningLevel).toBe("warning");
    expect(status.uploadAllowed).toBe(true);
  });

  it("returns 'critical' at 90%", async () => {
    // 9 GiB used of 10 GiB = 90%
    const used = 9_663_676_416n;
    vi.mocked(prisma.file.aggregate).mockResolvedValue(makeAgg(used));
    vi.mocked(prisma.reverseShareFile.aggregate).mockResolvedValue(makeAgg(0n));

    const status = await service.getQuotaStatus("user-1");

    expect(status.percentage).toBe(90);
    expect(status.warningLevel).toBe("critical");
    expect(status.uploadAllowed).toBe(true);
  });

  it("returns 'exceeded' at 100% (used >= limit)", async () => {
    // 10 GiB used of 10 GiB = 100%
    const used = GLOBAL_MAX_TOTAL_STORAGE;
    vi.mocked(prisma.file.aggregate).mockResolvedValue(makeAgg(used));
    vi.mocked(prisma.reverseShareFile.aggregate).mockResolvedValue(makeAgg(0n));

    const status = await service.getQuotaStatus("user-1");

    expect(status.percentage).toBe(100);
    expect(status.warningLevel).toBe("exceeded");
    expect(status.uploadAllowed).toBe(false);
  });

  it("returns 'exceeded' and uploadAllowed=false when usage exceeds limit", async () => {
    // 11 GiB used (over-quota)
    const used = 11_811_160_064n;
    vi.mocked(prisma.file.aggregate).mockResolvedValue(makeAgg(used));
    vi.mocked(prisma.reverseShareFile.aggregate).mockResolvedValue(makeAgg(0n));

    const status = await service.getQuotaStatus("user-1");

    expect(status.warningLevel).toBe("exceeded");
    expect(status.uploadAllowed).toBe(false);
  });

  it("returns unlimited status (0% used, 'none' warning, uploadAllowed) when limit is 0", async () => {
    // Admin user → unlimited
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      isAdmin: true,
      maxFileSizeOverride: null,
      maxTotalStorageOverride: null,
      group: null,
    } as never);

    // Even with massive usage, admin is never blocked
    const used = 100_000_000_000n;
    vi.mocked(prisma.file.aggregate).mockResolvedValue(makeAgg(used));
    vi.mocked(prisma.reverseShareFile.aggregate).mockResolvedValue(makeAgg(0n));

    const status = await service.getQuotaStatus("admin-1");

    expect(status.maxTotalStorage).toBe(0n);
    expect(status.percentage).toBe(0);
    expect(status.warningLevel).toBe("none");
    expect(status.uploadAllowed).toBe(true);
  });
});

// ─── QuotaService.parseThresholds ───────────────────────────────────────────

describe("QuotaService.parseThresholds", () => {
  const service = new QuotaService();

  it("parses a simple ascending CSV", () => {
    expect(service.parseThresholds("80,90")).toEqual([80, 90]);
  });

  it("sorts ascending regardless of input order", () => {
    expect(service.parseThresholds("90,80,50")).toEqual([50, 80, 90]);
  });

  it("de-duplicates repeated values", () => {
    expect(service.parseThresholds("80,80,90,80")).toEqual([80, 90]);
  });

  it("trims whitespace around entries", () => {
    expect(service.parseThresholds(" 80 , 90 ")).toEqual([80, 90]);
  });

  it("ignores empty segments (defensive — validator already rejects them)", () => {
    expect(service.parseThresholds("80,,90")).toEqual([80, 90]);
  });

  it("handles a single threshold", () => {
    expect(service.parseThresholds("95")).toEqual([95]);
  });
});

// ─── QuotaService.highestCrossedThreshold ───────────────────────────────────

describe("QuotaService.highestCrossedThreshold", () => {
  const service = new QuotaService();
  const LIMIT = 1000n; // boundaries: 80% = 800, 90% = 900, 100% = 1000

  it("returns null when no threshold is crossed", () => {
    expect(service.highestCrossedThreshold(0n, 500n, LIMIT, [80, 90])).toBeNull();
  });

  it("returns the threshold crossed by an upward transition", () => {
    expect(service.highestCrossedThreshold(700n, 850n, LIMIT, [80, 90])).toBe(80);
  });

  it("returns the HIGHEST threshold when several are crossed at once", () => {
    expect(service.highestCrossedThreshold(700n, 950n, LIMIT, [80, 90])).toBe(90);
  });

  it("treats >= 100 as the limit boundary (exceeded)", () => {
    expect(service.highestCrossedThreshold(950n, 1000n, LIMIT, [80, 90, 100])).toBe(100);
    expect(service.highestCrossedThreshold(950n, 1200n, LIMIT, [80, 90, 100])).toBe(100);
  });

  it("crosses exactly at the boundary (newUsed === boundary)", () => {
    expect(service.highestCrossedThreshold(799n, 800n, LIMIT, [80])).toBe(80);
  });

  it("does NOT re-cross a boundary already at/below oldUsed", () => {
    // oldUsed already at 800 (the 80% boundary) — 80% is not newly crossed.
    expect(service.highestCrossedThreshold(800n, 850n, LIMIT, [80, 90])).toBeNull();
    expect(service.highestCrossedThreshold(800n, 900n, LIMIT, [80, 90])).toBe(90);
  });

  it("never crosses on a downward transition", () => {
    expect(service.highestCrossedThreshold(950n, 700n, LIMIT, [80, 90])).toBeNull();
  });

  it("returns null for an unlimited limit (0n)", () => {
    expect(service.highestCrossedThreshold(0n, 10_000_000n, 0n, [80, 90])).toBeNull();
  });

  it("returns the max crossed value even when thresholds are unsorted", () => {
    expect(service.highestCrossedThreshold(0n, 1000n, LIMIT, [90, 80, 100])).toBe(100);
  });
});

// ─── QuotaService.isReverseUploadAllowed ────────────────────────────────────

describe("QuotaService.isReverseUploadAllowed", () => {
  const service = new QuotaService();
  const LIMIT = 1000n;

  it("always allows when the limit is unlimited (0n)", () => {
    expect(service.isReverseUploadAllowed(10_000n, 10_000n, 0n, 3, 0n)).toBe(true);
  });

  it("allows when projected usage stays within limit * factor (no absolute cap)", () => {
    // used 2000 + size 500 = 2500 <= 1000 * 3 = 3000
    expect(service.isReverseUploadAllowed(2000n, 500n, LIMIT, 3, 0n)).toBe(true);
  });

  it("blocks when projected usage exceeds limit * factor", () => {
    // used 2800 + size 500 = 3300 > 3000
    expect(service.isReverseUploadAllowed(2800n, 500n, LIMIT, 3, 0n)).toBe(false);
  });

  it("allows exactly at the relative cap boundary (projected === limit * factor)", () => {
    expect(service.isReverseUploadAllowed(2500n, 500n, LIMIT, 3, 0n)).toBe(true);
  });

  it("blocks when the absolute cap is exceeded even if within the relative cap", () => {
    // relative cap 3000 (within), absolute cap 2000 (exceeded): 1800 + 500 = 2300 > 2000
    expect(service.isReverseUploadAllowed(1800n, 500n, LIMIT, 3, 2000n)).toBe(false);
  });

  it("allows exactly at the absolute cap boundary", () => {
    expect(service.isReverseUploadAllowed(1500n, 500n, LIMIT, 3, 2000n)).toBe(true);
  });

  it("a non-positive absolute cap (<= 0n) means no absolute cap", () => {
    // projected 2900 within relative cap 3000; capBytes 0n is ignored.
    expect(service.isReverseUploadAllowed(2900n, 0n, LIMIT, 3, 0n)).toBe(true);
  });

  it("enforces both caps together (relative wins when smaller)", () => {
    // factor 3 → relative 3000; absolute 5000. 2900 + 200 = 3100 > 3000 → blocked.
    expect(service.isReverseUploadAllowed(2900n, 200n, LIMIT, 3, 5000n)).toBe(false);
  });

  it("a factor of 1 collapses the relative cap to the limit", () => {
    expect(service.isReverseUploadAllowed(900n, 100n, LIMIT, 1, 0n)).toBe(true); // 1000 <= 1000
    expect(service.isReverseUploadAllowed(900n, 200n, LIMIT, 1, 0n)).toBe(false); // 1100 > 1000
  });
});

// ─── QuotaService.pickDeletionCandidates ────────────────────────────────────

describe("QuotaService.pickDeletionCandidates", () => {
  let service: QuotaService;
  let findOrphan: ReturnType<typeof vi.spyOn>;
  let findInactive: ReturnType<typeof vi.spyOn>;

  const orphan = (id: string, size: bigint) => ({ id, objectName: `o/${id}`, size });
  const inactive = (id: string, size: bigint) => ({ id, objectName: `i/${id}`, size });

  beforeEach(() => {
    vi.clearAllMocks();
    service = new QuotaService();
    findOrphan = vi.spyOn(QuotaRepository.prototype, "findOrphanFiles");
    findInactive = vi.spyOn(QuotaRepository.prototype, "findInactiveShareFiles");
  });

  it("returns nothing when bytesToFree is zero or negative", async () => {
    const result = await service.pickDeletionCandidates("user-1", 0n, 30);
    expect(result).toEqual([]);
    expect(findOrphan).not.toHaveBeenCalled();
    expect(findInactive).not.toHaveBeenCalled();
  });

  it("selects orphan uploads first, oldest-first as returned by the repo", async () => {
    findOrphan.mockResolvedValue([orphan("a", 100n), orphan("b", 100n)]);
    findInactive.mockResolvedValue([]);

    const result = await service.pickDeletionCandidates("user-1", 150n, 30);

    // Stops once cumulative size (200) reaches bytesToFree (150) — both orphans needed.
    expect(result.map((f) => f.id)).toEqual(["a", "b"]);
    expect(findInactive).not.toHaveBeenCalled();
  });

  it("stops as soon as the cumulative size reaches bytesToFree", async () => {
    findOrphan.mockResolvedValue([orphan("a", 200n), orphan("b", 200n), orphan("c", 200n)]);
    findInactive.mockResolvedValue([]);

    const result = await service.pickDeletionCandidates("user-1", 150n, 30);

    expect(result.map((f) => f.id)).toEqual(["a"]);
  });

  it("falls through to inactive-share files only after exhausting orphans", async () => {
    findOrphan.mockResolvedValue([orphan("a", 100n)]);
    findInactive.mockResolvedValue([inactive("x", 100n), inactive("y", 100n)]);

    const result = await service.pickDeletionCandidates("user-1", 250n, 30);

    // orphan (100) + 2 inactive (200) = 300 >= 250, stops after y.
    expect(result.map((f) => f.id)).toEqual(["a", "x", "y"]);
    expect(findOrphan).toHaveBeenCalledWith("user-1");
  });

  it("returns ALL safe candidates when they cannot free enough (caller stays blocked)", async () => {
    findOrphan.mockResolvedValue([orphan("a", 100n)]);
    findInactive.mockResolvedValue([inactive("x", 100n)]);

    const result = await service.pickDeletionCandidates("user-1", 10_000n, 30);

    // Only 200 bytes available across all safe candidates — far below 10_000.
    expect(result.map((f) => f.id)).toEqual(["a", "x"]);
  });

  it("never includes active-share files (the repo query excludes them by construction)", async () => {
    // The repo returns ONLY orphans and inactive-share files; an active-share
    // file is never in either list, so it can never be selected.
    findOrphan.mockResolvedValue([]);
    findInactive.mockResolvedValue([]);

    const result = await service.pickDeletionCandidates("user-1", 1000n, 30);

    expect(result).toEqual([]);
  });

  it("computes the inactive cutoff as now - inactiveShareDays", async () => {
    findOrphan.mockResolvedValue([]);
    findInactive.mockResolvedValue([]);
    const now = new Date("2026-06-03T00:00:00.000Z");

    await service.pickDeletionCandidates("user-1", 1000n, 30, now);

    const expectedCutoff = new Date("2026-05-04T00:00:00.000Z");
    expect(findInactive).toHaveBeenCalledWith("user-1", expectedCutoff);
  });
});

// ─── QuotaService.evaluateAndNotifyQuota ────────────────────────────────────

describe("QuotaService.evaluateAndNotifyQuota", () => {
  let service: QuotaService;

  // Limit 1000n via a per-user override → boundaries: 80% = 800, 90% = 900,
  // 100% = 1000. The merged user record satisfies BOTH findUnique selects
  // (resolveEffectiveLimits + the warning state read).
  const LIMIT = 1000n;

  function mockUser(state: {
    quotaLastWarnedThreshold: number | null;
    quotaExceededSince: Date | null;
    isActive?: boolean;
    limit?: bigint;
  }) {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      // resolveEffectiveLimits select
      isAdmin: false,
      maxFileSizeOverride: 0n,
      maxTotalStorageOverride: state.limit ?? LIMIT,
      group: null,
      // warning-state select
      email: "owner@example.com",
      locale: "en",
      firstName: "Owner",
      lastName: "User",
      isActive: state.isActive ?? true,
      quotaLastWarnedThreshold: state.quotaLastWarnedThreshold,
      quotaExceededSince: state.quotaExceededSince,
    } as never);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    service = new QuotaService();
    vi.mocked(getConfigValue).mockImplementation(async (key: string) => {
      if (key === "quotaWarningThresholds") return "80,90";
      if (key === "quotaGracePeriodDays") return "7";
      throw new Error(`Unknown config key: ${key}`);
    });
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);
  });

  it("no-ops for an unlimited (0n) owner — no email, no state write", async () => {
    mockUser({ quotaLastWarnedThreshold: null, quotaExceededSince: null, limit: 0n });

    await service.evaluateAndNotifyQuota("user-1", { oldUsed: 0n, newUsed: 10_000n });

    expect(emailService.send).not.toHaveBeenCalled();
    expect(emailService.sendToAdmins).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("crossing 80% sends ONE quota_warning and stores the threshold", async () => {
    mockUser({ quotaLastWarnedThreshold: null, quotaExceededSince: null });

    // 750 → 850 crosses the 80% boundary (800).
    await service.evaluateAndNotifyQuota("user-1", { oldUsed: 750n, newUsed: 850n });

    expect(emailService.send).toHaveBeenCalledTimes(1);
    expect(emailService.send).toHaveBeenCalledWith(
      "quota_warning",
      expect.objectContaining({
        to: "owner@example.com",
        data: expect.objectContaining({ usedPercent: 85 }),
      }),
    );
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { quotaLastWarnedThreshold: 80 },
    });
    expect(emailService.sendToAdmins).not.toHaveBeenCalled();
  });

  it("a second upload still in the 80–90 band does NOT re-send (dedup)", async () => {
    // lastWarned already 80; 850 → 880 stays under the 90% boundary (900).
    mockUser({ quotaLastWarnedThreshold: 80, quotaExceededSince: null });

    await service.evaluateAndNotifyQuota("user-1", { oldUsed: 850n, newUsed: 880n });

    expect(emailService.send).not.toHaveBeenCalled();
    // No new crossing and no re-arm ⇒ no state write.
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("crossing 90% after already warning at 80% sends quota_warning at 90", async () => {
    mockUser({ quotaLastWarnedThreshold: 80, quotaExceededSince: null });

    // 880 → 950 crosses the 90% boundary (900).
    await service.evaluateAndNotifyQuota("user-1", { oldUsed: 880n, newUsed: 950n });

    expect(emailService.send).toHaveBeenCalledTimes(1);
    expect(emailService.send).toHaveBeenCalledWith("quota_warning", expect.anything());
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { quotaLastWarnedThreshold: 90 },
    });
  });

  it("reaching 100% sends quota_exceeded, alerts admins, and sets quotaExceededSince", async () => {
    mockUser({ quotaLastWarnedThreshold: 90, quotaExceededSince: null });

    // 950 → 1000 reaches the limit. The exceeded trigger is independent of the
    // configured thresholds (which are only 80/90 here).
    await service.evaluateAndNotifyQuota("user-1", { oldUsed: 950n, newUsed: 1000n });

    // The owner gets quota_exceeded (not quota_warning), exactly once.
    expect(emailService.send).toHaveBeenCalledTimes(1);
    expect(emailService.send).toHaveBeenCalledWith(
      "quota_exceeded",
      expect.objectContaining({
        to: "owner@example.com",
        data: expect.objectContaining({ gracePeriodDays: 7 }),
      }),
    );
    expect(emailService.sendToAdmins).toHaveBeenCalledWith(
      "admin_quota_alert",
      expect.objectContaining({ userEmail: "owner@example.com" }),
    );
    // quotaExceededSince is set (a Date); the warning dedup threshold is left
    // untouched (exceeded is owned by quotaExceededSince, not the threshold).
    const updateArg = vi.mocked(prisma.user.update).mock.calls[0]?.[0] as {
      data: { quotaLastWarnedThreshold?: number | null; quotaExceededSince?: Date | null };
    };
    expect(updateArg.data.quotaExceededSince).toBeInstanceOf(Date);
    expect(updateArg.data.quotaLastWarnedThreshold).toBeUndefined();
  });

  it("reaching 100% alerts even when 100 is NOT in the configured thresholds (no warning at 90 needed first)", async () => {
    // Fresh user (never warned), jump straight from 50% to 100%.
    mockUser({ quotaLastWarnedThreshold: null, quotaExceededSince: null });

    await service.evaluateAndNotifyQuota("user-1", { oldUsed: 500n, newUsed: 1000n });

    // Exceeded wins — quota_exceeded only (the 80/90 crossings are suppressed in
    // favor of the stronger exceeded notice).
    expect(emailService.send).toHaveBeenCalledTimes(1);
    expect(emailService.send).toHaveBeenCalledWith("quota_exceeded", expect.anything());
    expect(emailService.sendToAdmins).toHaveBeenCalledWith("admin_quota_alert", expect.anything());
  });

  it("a second over-limit upload does NOT re-alert admins (quotaExceededSince already set)", async () => {
    mockUser({ quotaLastWarnedThreshold: 100, quotaExceededSince: new Date("2026-01-01") });

    // Already over the limit; pushing further still over.
    await service.evaluateAndNotifyQuota("user-1", { oldUsed: 1000n, newUsed: 1100n });

    expect(emailService.sendToAdmins).not.toHaveBeenCalled();
    expect(emailService.send).not.toHaveBeenCalled();
    // No re-arm, no transition ⇒ no state write.
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("dropping below the lowest threshold re-arms quotaLastWarnedThreshold", async () => {
    mockUser({ quotaLastWarnedThreshold: 90, quotaExceededSince: null });

    // 950 → 500 drops below the 80% boundary (800).
    await service.evaluateAndNotifyQuota("user-1", { oldUsed: 950n, newUsed: 500n });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { quotaLastWarnedThreshold: null },
    });
    expect(emailService.send).not.toHaveBeenCalled();
  });

  it("dropping back under the limit clears quotaExceededSince", async () => {
    mockUser({ quotaLastWarnedThreshold: 90, quotaExceededSince: new Date("2026-01-01") });

    // 1000 → 850: under the limit (clears exceededSince) but still above the
    // lowest threshold (80% = 800), so the warning dedup stays armed.
    await service.evaluateAndNotifyQuota("user-1", { oldUsed: 1000n, newUsed: 850n });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { quotaExceededSince: null },
    });
  });

  it("updates state but skips the email for a deactivated owner", async () => {
    mockUser({ quotaLastWarnedThreshold: null, quotaExceededSince: null, isActive: false });

    await service.evaluateAndNotifyQuota("user-1", { oldUsed: 750n, newUsed: 850n });

    // State (dedup threshold) is still persisted...
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { quotaLastWarnedThreshold: 80 },
    });
    // ...but no email goes out to a deactivated account.
    expect(emailService.send).not.toHaveBeenCalled();
    expect(emailService.sendToAdmins).not.toHaveBeenCalled();
  });

  it("never throws — a failing user.update is swallowed", async () => {
    mockUser({ quotaLastWarnedThreshold: null, quotaExceededSince: null });
    vi.mocked(prisma.user.update).mockRejectedValue(new Error("db down"));

    await expect(
      service.evaluateAndNotifyQuota("user-1", { oldUsed: 750n, newUsed: 850n }),
    ).resolves.toBeUndefined();
  });
});
