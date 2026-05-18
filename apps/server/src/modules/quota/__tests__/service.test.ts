import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../shared/prisma.js", () => ({
  prisma: {
    file: { aggregate: vi.fn() },
    reverseShareFile: { aggregate: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));

vi.mock("../../config/service.js", () => ({
  getConfigValue: vi.fn(),
}));

import { prisma } from "../../../shared/prisma.js";
import { NotFoundError } from "../../../utils/app-error.js";
import { getConfigValue } from "../../config/service.js";
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
    } as never);

    const limits = await service.resolveEffectiveLimits("user-1");

    expect(limits.maxFileSize).toBe(GLOBAL_MAX_FILE_SIZE);
    expect(limits.maxTotalStorage).toBe(GLOBAL_MAX_TOTAL_STORAGE);
    expect(getConfigValue).toHaveBeenCalledWith("maxFileSize");
    expect(getConfigValue).toHaveBeenCalledWith("maxTotalStoragePerUser");
  });

  it("returns unlimited (0n) for admin with no overrides", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      isAdmin: true,
      maxFileSizeOverride: null,
      maxTotalStorageOverride: null,
    } as never);

    const limits = await service.resolveEffectiveLimits("admin-1");

    expect(limits.maxFileSize).toBe(0n);
    expect(limits.maxTotalStorage).toBe(0n);
    // Global defaults should NOT be called for admins with no override
    expect(getConfigValue).not.toHaveBeenCalled();
  });

  it("respects per-user override for regular user", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      isAdmin: false,
      maxFileSizeOverride: 524_288_000n, // 500 MiB
      maxTotalStorageOverride: 2_147_483_648n, // 2 GiB
    } as never);

    const limits = await service.resolveEffectiveLimits("user-1");

    expect(limits.maxFileSize).toBe(524_288_000n);
    expect(limits.maxTotalStorage).toBe(2_147_483_648n);
    expect(getConfigValue).not.toHaveBeenCalled();
  });

  it("respects per-user override for admin (can restrict admin)", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      isAdmin: true,
      maxFileSizeOverride: 104_857_600n, // 100 MiB (restricted)
      maxTotalStorageOverride: 5_368_709_120n, // 5 GiB (restricted)
    } as never);

    const limits = await service.resolveEffectiveLimits("admin-1");

    expect(limits.maxFileSize).toBe(104_857_600n);
    expect(limits.maxTotalStorage).toBe(5_368_709_120n);
    expect(getConfigValue).not.toHaveBeenCalled();
  });

  it("treats override value 0 as unlimited", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      isAdmin: false,
      maxFileSizeOverride: 0n,
      maxTotalStorageOverride: 0n,
    } as never);

    const limits = await service.resolveEffectiveLimits("user-1");

    expect(limits.maxFileSize).toBe(0n);
    expect(limits.maxTotalStorage).toBe(0n);
    // Override is explicitly 0n (falsy in JS but not null) — should NOT fall through to global
    expect(getConfigValue).not.toHaveBeenCalled();
  });

  it("allows partial overrides (one null, one set)", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      isAdmin: false,
      maxFileSizeOverride: 209_715_200n, // 200 MiB override
      maxTotalStorageOverride: null, // inherit global
    } as never);

    const limits = await service.resolveEffectiveLimits("user-1");

    expect(limits.maxFileSize).toBe(209_715_200n);
    expect(limits.maxTotalStorage).toBe(GLOBAL_MAX_TOTAL_STORAGE);
    // Only maxTotalStoragePerUser should be fetched
    expect(getConfigValue).toHaveBeenCalledWith("maxTotalStoragePerUser");
    expect(getConfigValue).not.toHaveBeenCalledWith("maxFileSize");
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

    // Default user: regular, no overrides
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      isAdmin: false,
      maxFileSizeOverride: null,
      maxTotalStorageOverride: null,
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
