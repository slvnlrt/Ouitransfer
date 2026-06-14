/**
 * user-linking.service.test.ts — federated account-linking guard (A5-02).
 *
 * The core invariant: a federated identity is NEVER auto-linked to a pre-existing
 * local account on a matching email alone. Auto-link requires email_verified from
 * the IdP AND a verified local account; otherwise the login is refused.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockUserAuthProviderFindUnique,
  mockUserAuthProviderFindFirst,
  mockUserAuthProviderCreate,
  mockUserFindUnique,
  mockUserUpdate,
  mockUserCreate,
  mockUserCount,
} = vi.hoisted(() => ({
  mockUserAuthProviderFindUnique: vi.fn(),
  mockUserAuthProviderFindFirst: vi.fn(),
  mockUserAuthProviderCreate: vi.fn(),
  mockUserFindUnique: vi.fn(),
  mockUserUpdate: vi.fn(),
  mockUserCreate: vi.fn(),
  mockUserCount: vi.fn(),
}));

vi.mock("../../../shared/prisma.js", () => ({
  prisma: {
    userAuthProvider: {
      findUnique: mockUserAuthProviderFindUnique,
      findFirst: mockUserAuthProviderFindFirst,
      create: mockUserAuthProviderCreate,
    },
    user: {
      findUnique: mockUserFindUnique,
      update: mockUserUpdate,
      create: mockUserCreate,
      count: mockUserCount,
    },
  },
}));

vi.mock("../../email/service.js", () => ({
  emailService: { sendToAdmins: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock("../../../utils/logger.js", () => ({
  getLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

import { UserLinkingService } from "../user-linking.service.js";

const PROVIDER = {
  id: "prov-1",
  name: "google",
  displayName: "Google",
  autoRegister: true,
};

function localUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "local-1",
    email: "victim@corp.com",
    username: "victim",
    firstName: "Vic",
    lastName: "Tim",
    image: null,
    emailVerified: false,
    ...overrides,
  };
}

describe("UserLinkingService.findOrCreateUser — A5-02 linking guard", () => {
  let service: UserLinkingService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new UserLinkingService();
    mockUserAuthProviderFindUnique.mockResolvedValue(null); // no (provider, externalId) link yet
    mockUserAuthProviderFindFirst.mockResolvedValue(null); // not yet linked to this provider
    mockUserCount.mockResolvedValue(2);
  });

  it("REFUSES to log in when a local account exists but the IdP email is unverified", async () => {
    mockUserFindUnique.mockResolvedValue(localUser({ emailVerified: true }));

    await expect(
      service.findOrCreateUser(
        { id: "ext-1", email: "victim@corp.com", emailVerified: false },
        PROVIDER,
      ),
    ).rejects.toThrow(/already exists/i);

    expect(mockUserAuthProviderCreate).not.toHaveBeenCalled();
  });

  it("REFUSES to log in when the IdP email is verified but the local account is unverified", async () => {
    mockUserFindUnique.mockResolvedValue(localUser({ emailVerified: false }));

    await expect(
      service.findOrCreateUser(
        { id: "ext-1", email: "victim@corp.com", emailVerified: true },
        PROVIDER,
      ),
    ).rejects.toThrow(/already exists/i);

    expect(mockUserAuthProviderCreate).not.toHaveBeenCalled();
  });

  it("auto-links only when BOTH the IdP and the local account are verified", async () => {
    mockUserFindUnique.mockResolvedValue(localUser({ emailVerified: true }));
    mockUserUpdate.mockImplementation(async ({ data }) => ({ ...localUser(), ...data }));

    const result = await service.findOrCreateUser(
      { id: "ext-1", email: "victim@corp.com", emailVerified: true },
      PROVIDER,
    );

    expect(mockUserAuthProviderCreate).toHaveBeenCalledTimes(1);
    expect(result.id).toBe("local-1");
  });

  it("a repeat SSO login for an already-linked identity still works", async () => {
    mockUserFindUnique.mockResolvedValue(localUser({ emailVerified: false }));
    mockUserAuthProviderFindFirst.mockResolvedValue({ id: "uap-1" }); // already linked
    mockUserUpdate.mockResolvedValue(localUser());

    const result = await service.findOrCreateUser(
      { id: "ext-1", email: "victim@corp.com", emailVerified: false },
      PROVIDER,
    );

    // No new link row; just a profile refresh / passthrough.
    expect(mockUserAuthProviderCreate).not.toHaveBeenCalled();
    expect(result.id).toBe("local-1");
  });

  it("creates a brand-new user and persists emailVerified provenance", async () => {
    mockUserFindUnique.mockResolvedValue(null); // no local account
    mockUserCreate.mockImplementation(async ({ data }) => ({ id: "new-1", ...data }));

    await service.findOrCreateUser(
      { id: "ext-9", email: "new@corp.com", emailVerified: true, name: "New User" },
      PROVIDER,
    );

    expect(mockUserCreate).toHaveBeenCalledTimes(1);
    const arg = mockUserCreate.mock.calls[0][0];
    expect(arg.data.emailVerified).toBe(true);
    expect(arg.data.email).toBe("new@corp.com");
  });

  it("new user from an unverified IdP email is created unverified", async () => {
    mockUserFindUnique.mockResolvedValue(null);
    mockUserCreate.mockImplementation(async ({ data }) => ({ id: "new-2", ...data }));

    await service.findOrCreateUser(
      { id: "ext-10", email: "new2@corp.com", emailVerified: false },
      PROVIDER,
    );

    const arg = mockUserCreate.mock.calls[0][0];
    expect(arg.data.emailVerified).toBe(false);
  });
});
