/**
 * auth-mocks.ts
 *
 * Shared mock instances and factory helpers for auth-related integration and
 * unit tests. Because Vitest hoists `vi.mock()` calls, the factory callbacks
 * themselves MUST remain in each test file. What we CAN share are:
 *
 * - Standalone `vi.fn()` instances that the mock factories close over, so test
 *   files can reference and assert on them without re-declaring.
 * - Class-shape factories that every mock factory can delegate to.
 * - Test-data builders (e.g. `makeTestUser`) used across multiple files.
 *
 * Usage pattern in a test file:
 *
 *   import { mockVerifyToken, mockIsEnabled, makeTestUser } from './fixtures/auth-mocks.js';
 *
 *   vi.mock('../modules/two-factor/service.js', () => ({
 *     TwoFactorService: class {
 *       isEnabled = mockIsEnabled;
 *       verifyToken = mockVerifyToken;
 *     },
 *   }));
 */

import { vi } from "vitest";

// ── Shared mock function instances ───────────────────────────────────────────
// These are module-level vi.fn() instances created once. The vi.mock() factory
// in each test file closes over them, so assertions can be made directly on
// these exported references.

/** Mock for TwoFactorService#verifyToken */
export const mockVerifyToken = vi.fn();

/** Mock for TwoFactorService#isEnabled — defaults to 2FA disabled */
export const mockIsEnabled = vi.fn().mockResolvedValue(false);

/** Mock for PrismaUserRepository#findUserByEmailOrUsername */
export const mockFindUserByEmailOrUsername = vi.fn();

// ── Mock class shape factories ────────────────────────────────────────────────
// Each factory returns a class constructor whose instances satisfy the interface
// that the module under test expects. Using factories (functions that return
// classes) lets each test file call the factory inside its own vi.mock() so
// Vitest's hoisting does not cause "used before declaration" errors.

/**
 * Returns a `TrustedDeviceService` mock class. All methods are vi.fn().
 * `isDeviceTrusted` defaults to `false` (device not trusted).
 */
export function makeTrustedDeviceServiceClass() {
  return class {
    isDeviceTrusted = vi.fn().mockResolvedValue(false);
    addTrustedDevice = vi.fn();
    updateLastUsed = vi.fn();
    getUserTrustedDevices = vi.fn();
    removeTrustedDevice = vi.fn();
    removeAllTrustedDevices = vi.fn();
  };
}

/**
 * Returns a `TwoFactorService` mock class backed by the shared
 * `mockIsEnabled` and `mockVerifyToken` instances so tests can assert on them.
 *
 * @param isEnabledDefault - override the default resolved value for isEnabled
 *   (default: false — 2FA disabled).
 */
export function makeTwoFactorServiceClass(isEnabledDefault = false) {
  // Reset the shared mock to the requested default each time a new class is made.
  mockIsEnabled.mockResolvedValue(isEnabledDefault);
  return class {
    isEnabled = mockIsEnabled;
    verifyToken = mockVerifyToken;
  };
}

/**
 * Returns a mock `emailService` singleton object.
 * `send` is a vi.fn() — not asserted on in lockout tests.
 */
export function makeEmailServiceMock() {
  return {
    send: vi.fn().mockResolvedValue(undefined),
    sendToAdmins: vi.fn().mockResolvedValue(undefined),
    resolveFrequency: vi.fn(),
    generateUnsubscribeUrl: vi.fn(),
  };
}

/**
 * Returns a `PrismaUserRepository` mock class backed by the shared
 * `mockFindUserByEmailOrUsername` instance.
 */
export function makeUserRepositoryClass() {
  return class {
    findUserByEmailOrUsername = mockFindUserByEmailOrUsername;
    findUserByEmail = vi.fn();
  };
}

// ── Test-data builders ────────────────────────────────────────────────────────

export interface TestUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  username: string;
  password: string;
  isAdmin: boolean;
  isActive: boolean;
  totpEnabled: boolean;
  totpSecret: string;
  totpVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Returns a minimal test user object matching the Prisma User shape.
 * Override any field via the optional `overrides` argument.
 */
export function makeTestUser(overrides: Partial<TestUser> = {}): TestUser {
  return {
    id: "user-1",
    email: "test@example.com",
    firstName: "Test",
    lastName: "User",
    username: "testuser",
    password: "hashed",
    isAdmin: false,
    isActive: true,
    totpEnabled: true,
    totpSecret: "secret",
    totpVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ── Common lock-state helpers ─────────────────────────────────────────────────

/** The default "not locked" state for isAccountLocked mock */
export const UNLOCKED_STATE = { locked: false, remainingMinutes: 0 } as const;
