/**
 * auth-r3a.integration.test.ts
 *
 * Full request-lifecycle (`app.inject()`) coverage for the R3a auth-hardening
 * batch:
 *   - A1-01 / A8-02: spoofed X-Real-IP no longer influences the audit IP or the
 *     lockout/throttle accounting; per-IP failed-login throttle.
 *   - A1-02: standalone POST /2fa/verify is gated by a dedicated 2FA lockout.
 *   - A1-03: TOTP replay (re-using a consumed step) is rejected.
 *   - A1-04: trusted-device trust is keyed on a server-issued cookie secret and
 *     is isolated per-user (no cross-user collision).
 *   - A1-05: enabling 2FA requires password re-authentication.
 *
 * Strategy: prisma is mocked at the row level; the auth/2FA/trusted-device/
 * login-attempts/challenge services and getClientInfo run for real so the tests
 * exercise the true wiring, not mocks of the code under test.
 */

import { ErrorCodes } from "@ouitransfer/shared/error-codes";
import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";
import * as OTPAuth from "otpauth";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ── In-memory login-attempt store backing the real login-attempts service ────
interface AttemptRow {
  email: string;
  ipAddress: string;
  success: boolean;
  createdAt: Date;
}
const attemptStore: AttemptRow[] = [];

// Mutable user row returned by prisma.user.findUnique (per-test customisable).
let userRow: Record<string, unknown> | null = null;
// Mutable trusted-device store (real service writes/reads through these mocks).
interface DeviceRow {
  id: string;
  userId: string;
  deviceHash: string;
  expiresAt: Date;
  lastUsedAt: Date;
  deviceName: string | null;
  userAgent: string | null;
  ipAddress: string | null;
}
let deviceStore: DeviceRow[] = [];

vi.mock("../shared/prisma.js", () => ({
  prisma: {
    user: {
      count: vi.fn().mockResolvedValue(1),
      findUnique: vi.fn(async () => userRow),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (userRow) Object.assign(userRow, data);
        return userRow;
      }),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          // Emulate the conditional lastTotpStep advance used for replay protection.
          const or = (where as { OR?: Array<Record<string, unknown>> }).OR;
          let matches = true;
          if (or) {
            const current = (userRow?.lastTotpStep ?? null) as number | null;
            const target = (data.lastTotpStep ?? 0) as number;
            matches = current === null || current < target;
          }
          if (matches && userRow) {
            Object.assign(userRow, data);
            return { count: 1 };
          }
          return { count: 0 };
        },
      ),
    },
    refreshToken: {
      create: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    trustedDevice: {
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: { userId: string; deviceHash: string; expiresAt?: { gt: Date } };
        }) => {
          return (
            deviceStore.find(
              (d) =>
                d.userId === where.userId &&
                d.deviceHash === where.deviceHash &&
                (!where.expiresAt || d.expiresAt > where.expiresAt.gt),
            ) ?? null
          );
        },
      ),
      upsert: vi.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { userId_deviceHash: { userId: string; deviceHash: string } };
          create: Omit<DeviceRow, "id">;
          update: Partial<DeviceRow>;
        }) => {
          const key = where.userId_deviceHash;
          const existing = deviceStore.find(
            (d) => d.userId === key.userId && d.deviceHash === key.deviceHash,
          );
          if (existing) {
            Object.assign(existing, update);
            return existing;
          }
          const row: DeviceRow = {
            id: `dev-${deviceStore.length + 1}`,
            ...create,
          };
          deviceStore.push(row);
          return row;
        },
      ),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    loginAttempt: {
      create: vi.fn(async ({ data }: { data: Omit<AttemptRow, "createdAt"> }) => {
        attemptStore.push({ ...data, createdAt: new Date() });
        return {};
      }),
      findMany: vi.fn(
        async ({
          where,
          take,
        }: {
          where: {
            email?: string;
            ipAddress?: string;
            success?: boolean;
            createdAt?: { gte: Date };
          };
          take?: number;
        }) => {
          let rows = attemptStore.filter((r) => {
            if (where.email !== undefined && r.email !== where.email) return false;
            if (where.ipAddress !== undefined && r.ipAddress !== where.ipAddress) return false;
            if (where.success !== undefined && r.success !== where.success) return false;
            if (where.createdAt?.gte && r.createdAt < where.createdAt.gte) return false;
            return true;
          });
          rows = rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          return take ? rows.slice(0, take) : rows;
        },
      ),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    passwordReset: { findFirst: vi.fn() },
  },
}));

vi.mock("../modules/config/service.js", () => ({
  getConfigValue: vi.fn(async (key: string) => {
    if (key === "passwordMinLength") return "8";
    return "true";
  }),
  validatePasswordAuthDisable: vi.fn().mockResolvedValue(true),
  validateAllProvidersDisable: vi.fn().mockResolvedValue(true),
}));

vi.mock("../modules/email/service.js", () => ({
  emailService: {
    send: vi.fn().mockResolvedValue(undefined),
    sendToAdmins: vi.fn().mockResolvedValue(undefined),
    resolveFrequency: vi.fn(),
    generateUnsubscribeUrl: vi.fn(),
  },
}));

// User repository — backed by the same mutable userRow.
vi.mock("../modules/user/repository.js", () => ({
  PrismaUserRepository: class {
    findUserByEmailOrUsername = vi.fn(async () => userRow);
    findUserByEmail = vi.fn(async () => userRow);
  },
}));

vi.mock("../modules/user/dto.js", () => ({
  UserResponseSchema: { parse: vi.fn((u: unknown) => u) },
}));

// Token-version revocation hooks are no-ops in tests.
vi.mock("../modules/auth/token-version.js", () => ({
  incrementTokenVersion: vi.fn().mockResolvedValue(undefined),
  invalidateTokenVersionCache: vi.fn(),
  validateTokenVersion: vi.fn().mockResolvedValue(true),
}));

const ENCRYPTION_SECRET = "test-encryption-secret-3333333333-32+chars";

/** Build a TOTP for a freshly-generated secret; returns base32 + a code generator. */
function makeTotp() {
  const secret = new OTPAuth.Secret({ size: 20 });
  const totp = new OTPAuth.TOTP({ algorithm: "SHA1", digits: 6, period: 30, secret });
  return { base32: secret.base32, totp };
}

describe("R3a auth hardening — integration", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("JWT_SECRET", "a]test-jwt-secret-32-chars-long!");
    vi.stubEnv("CSRF_SECRET", "b]test-csrf-secret-32chars-long!");
    vi.stubEnv("COOKIE_SECRET", "c]test-cookie-secret-32chars-lon");
    vi.stubEnv("ENCRYPTION_SECRET", ENCRYPTION_SECRET);
    vi.stubEnv("NODE_ENV", "test");

    const { buildApp } = await import("../app.js");
    app = await buildApp();

    const { authRoutes } = await import("../modules/auth/routes.js");
    const { twoFactorRoutes } = await import("../modules/two-factor/routes.js");
    app.register(authRoutes);
    app.register(twoFactorRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    attemptStore.length = 0;
    deviceStore = [];
    userRow = null;
    vi.clearAllMocks();
  });

  /** Issue a signed JWT cookie value for `userId`. */
  function jwtCookie(userId: string): string {
    const jwt = app.jwt.sign({ userId, isAdmin: false, tokenVersion: 0 });
    return `token=${app.signCookie(jwt)}`;
  }

  /**
   * Build headers for an authenticated, CSRF-protected POST: combines the JWT
   * cookie, the _csrf cookie, and the x-csrf-token header.
   */
  async function authPostHeaders(userId: string): Promise<Record<string, string>> {
    const csrfRes = await app.inject({ method: "GET", url: "/csrf-token" });
    const { token } = csrfRes.json();
    const csrfCookie = csrfRes.cookies.find((c: { name: string }) => c.name === "_csrf");
    return {
      cookie: `${jwtCookie(userId)}; _csrf=${csrfCookie?.value}`,
      "x-csrf-token": token,
    };
  }

  // ── A1-01 / A8-02 ───────────────────────────────────────────────────────────
  describe("A1-01/A8-02 — spoofed X-Real-IP and per-IP throttle", () => {
    it("ignores a forged X-Real-IP: failed-login attempt is recorded under request.ip", async () => {
      userRow = null; // user does not exist → recordLoginAttempt(false) runs
      await app.inject({
        method: "POST",
        url: "/auth/login",
        headers: { "x-real-ip": "8.8.8.8", "x-user-agent": "Spoofed/1.0" },
        payload: { emailOrUsername: "ghost@example.com", password: "whatever" },
      });

      expect(attemptStore.length).toBe(1);
      // request.ip in app.inject defaults to 127.0.0.1 — never the forged 8.8.8.8.
      expect(attemptStore[0].ipAddress).not.toBe("8.8.8.8");
      expect(attemptStore[0].ipAddress).toBe("127.0.0.1");
    });

    it("throttles a single IP after the per-IP failure ceiling across many emails", async () => {
      userRow = null;
      // Seed 30 failures from 127.0.0.1 across distinct emails (within the window).
      for (let i = 0; i < 30; i++) {
        attemptStore.push({
          email: `target${i}@example.com`,
          ipAddress: "127.0.0.1",
          success: false,
          createdAt: new Date(),
        });
      }

      const res = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { emailOrUsername: "fresh@example.com", password: "whatever" },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe(ErrorCodes.ACCOUNT_LOCKED);
      expect(res.json().error).toContain("network");
    });
  });

  // ── A1-05 ─────────────────────────────────────────────────────────────────
  describe("A1-05 — enabling 2FA requires password re-auth", () => {
    it("rejects /2fa/verify-setup with a wrong password even when the TOTP is valid", async () => {
      const { base32, totp } = makeTotp();
      userRow = {
        id: "user-1",
        email: "u1@example.com",
        password: await bcrypt.hash("correct-password", 10),
        twoFactorEnabled: false,
      };

      const res = await app.inject({
        method: "POST",
        url: "/2fa/verify-setup",
        headers: await authPostHeaders("user-1"),
        payload: { token: totp.generate(), secret: base32, password: "WRONG-password" },
      });

      expect(res.statusCode).toBe(401);
      // 2FA must NOT have been enabled.
      expect(userRow.twoFactorEnabled).toBe(false);
    });

    it("enables 2FA when the password and TOTP are both correct", async () => {
      const { base32, totp } = makeTotp();
      userRow = {
        id: "user-1",
        email: "u1@example.com",
        password: await bcrypt.hash("correct-password", 10),
        twoFactorEnabled: false,
      };

      const res = await app.inject({
        method: "POST",
        url: "/2fa/verify-setup",
        headers: await authPostHeaders("user-1"),
        payload: { token: totp.generate(), secret: base32, password: "correct-password" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
      expect(userRow.twoFactorEnabled).toBe(true);
    });
  });

  // ── A1-02 ─────────────────────────────────────────────────────────────────
  describe("A1-02 — standalone /2fa/verify lockout", () => {
    it("blocks /2fa/verify once the dedicated 2FA failure threshold is reached", async () => {
      const { base32 } = makeTotp();
      userRow = {
        id: "user-1",
        email: "u1@example.com",
        twoFactorEnabled: true,
        twoFactorSecret: (await import("../utils/encryption.js")).encryptSecret(
          base32,
          "totp-secret",
        ),
        twoFactorBackupCodes: null,
        lastTotpStep: null,
      };
      // Pre-seed 5 failures (MAX_2FA_VERIFY_ATTEMPTS) for this email so the very
      // next call is rejected by the lockout pre-check (avoids colliding with the
      // route's 5/min rate limit, which we exercise separately above).
      for (let i = 0; i < 5; i++) {
        attemptStore.push({
          email: "u1@example.com",
          ipAddress: "10.0.0.50",
          success: false,
          createdAt: new Date(),
        });
      }

      const headers = await authPostHeaders("user-1");
      const res = await app.inject({
        method: "POST",
        url: "/2fa/verify",
        headers,
        remoteAddress: "10.0.0.50",
        payload: { token: "000000" },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe(ErrorCodes.ACCOUNT_LOCKED);
    });
  });

  // ── A1-03 ─────────────────────────────────────────────────────────────────
  describe("A1-03 — TOTP replay rejection", () => {
    it("rejects a TOTP code re-used after its step was consumed", async () => {
      const { base32, totp } = makeTotp();
      userRow = {
        id: "user-1",
        email: "u1@example.com",
        twoFactorEnabled: true,
        twoFactorSecret: (await import("../utils/encryption.js")).encryptSecret(
          base32,
          "totp-secret",
        ),
        twoFactorBackupCodes: null,
        lastTotpStep: null,
      };
      const code = totp.generate();
      const headers = await authPostHeaders("user-1");

      const first = await app.inject({
        method: "POST",
        url: "/2fa/verify",
        headers,
        remoteAddress: "10.0.0.60",
        payload: { token: code },
      });
      expect(first.statusCode).toBe(200);
      expect(first.json().success).toBe(true);

      // Same code, same step → replay must be rejected.
      const replay = await app.inject({
        method: "POST",
        url: "/2fa/verify",
        headers,
        remoteAddress: "10.0.0.60",
        payload: { token: code },
      });
      expect(replay.statusCode).toBe(401);
    });
  });

  // ── A1-04 ─────────────────────────────────────────────────────────────────
  describe("A1-04 — trusted-device isolation via the real service", () => {
    it("does not trust user B with user A's device secret, and trusts within the same user", async () => {
      const { TrustedDeviceService } = await import("../modules/auth/trusted-device.service.js");
      const svc = new TrustedDeviceService();

      const secret = svc.generateDeviceSecret();
      await svc.addTrustedDevice("user-A", secret, { ipAddress: "1.1.1.1", userAgent: "UA" });

      // Same secret, same user → trusted.
      expect(await svc.isDeviceTrusted("user-A", secret)).toBe(true);
      // Same secret, DIFFERENT user → NOT trusted (per-user scoping).
      expect(await svc.isDeviceTrusted("user-B", secret)).toBe(false);
      // Missing secret → never trusted.
      expect(await svc.isDeviceTrusted("user-A", undefined)).toBe(false);

      // User B can independently trust their own (different) secret — no collision.
      const secretB = svc.generateDeviceSecret();
      await svc.addTrustedDevice("user-B", secretB, { ipAddress: "2.2.2.2", userAgent: "UA" });
      expect(await svc.isDeviceTrusted("user-B", secretB)).toBe(true);
      expect(deviceStore.length).toBe(2);
      // The two device hashes are distinct random secrets, not derived from UA/IP.
      expect(deviceStore[0].deviceHash).not.toBe(deviceStore[1].deviceHash);
    });
  });
});
