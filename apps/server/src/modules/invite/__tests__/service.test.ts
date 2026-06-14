import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock prisma before importing the service that uses it.
vi.mock("../../../shared/prisma.js", () => ({
  prisma: {
    inviteToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    // registerWithInvite runs its claim + user create inside a transaction; the
    // mock just invokes the callback with the same prisma facade.
    $transaction: vi.fn(),
  },
}));

// Mock the email service so no real queueing happens.
vi.mock("../../email/service.js", () => ({
  emailService: {
    send: vi.fn(),
    sendToAdmins: vi.fn().mockResolvedValue({ enqueued: true }),
  },
}));

// Mock the URL builder so it doesn't read appUrl from config.
vi.mock("../../email/url-builder.js", () => ({
  buildInviteRegistrationUrl: vi.fn(
    async (token: string) => `https://transfer.example.com/register-with-invite/${token}`,
  ),
}));

// Mock the logger so the error path (send throws) doesn't hit an uninitialized logger.
vi.mock("../../../utils/logger.js", () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { prisma } from "../../../shared/prisma.js";
import { emailService } from "../../email/service.js";
import { buildInviteRegistrationUrl } from "../../email/url-builder.js";
import { InviteService } from "../service.js";

const service = new InviteService();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.inviteToken.create).mockResolvedValue({ id: "invite-1" } as never);
  // Default transaction runner: invoke the callback with the same prisma facade.
  vi.mocked(prisma.$transaction).mockImplementation(
    // biome-ignore lint/suspicious/noExplicitAny: test harness — pass the prisma mock through as the tx client
    async (cb: any) => cb(prisma),
  );
});

describe("InviteService.generateInviteToken", () => {
  it("creates a token with a 15-minute expiry and does not email when no address is given", async () => {
    const before = Date.now();
    const result = await service.generateInviteToken("admin-1");
    const after = Date.now();

    expect(prisma.inviteToken.create).toHaveBeenCalledTimes(1);
    const created = vi.mocked(prisma.inviteToken.create).mock.calls[0][0].data;
    expect(created.createdBy).toBe("admin-1");
    // Expiry is 15 minutes out (allow a small window for execution time).
    const expiresAtMs = new Date(created.expiresAt).getTime();
    expect(expiresAtMs - before).toBeGreaterThanOrEqual(15 * 60 * 1000 - 5);
    expect(expiresAtMs).toBeLessThanOrEqual(after + 15 * 60 * 1000 + 5);

    expect(result.id).toBe("invite-1");
    expect(result.token).toMatch(/^[0-9a-f]{64}$/);
    expect(result.emailSent).toBe(false);
    expect(emailService.send).not.toHaveBeenCalled();
    // The absolute link (from the configured appUrl) is returned for the admin
    // to copy, even when no invitation email is sent.
    expect(result.registrationUrl).toBe(
      `https://transfer.example.com/register-with-invite/${result.token}`,
    );
  });

  it("returns registrationUrl: null when appUrl is not configured (builder throws)", async () => {
    vi.mocked(buildInviteRegistrationUrl).mockRejectedValueOnce(
      new Error("appUrl is not configured or empty"),
    );

    const result = await service.generateInviteToken("admin-1");

    // Token generation must not fail just because appUrl is unset; the client
    // falls back to its own origin.
    expect(result.token).toMatch(/^[0-9a-f]{64}$/);
    expect(result.registrationUrl).toBeNull();
  });

  it("sends a user_invitation email with the inviter's name, locale and link when an email is given", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      firstName: "Ada",
      lastName: "Lovelace",
      locale: "fr",
    } as never);
    vi.mocked(emailService.send).mockResolvedValue({ enqueued: true });

    const result = await service.generateInviteToken("admin-1", "newcomer@example.com");

    expect(result.emailSent).toBe(true);
    expect(emailService.send).toHaveBeenCalledTimes(1);
    const [type, options] = vi.mocked(emailService.send).mock.calls[0];
    expect(type).toBe("user_invitation");
    expect(options.to).toBe("newcomer@example.com");
    expect(options.locale).toBe("fr");
    expect(options.userId).toBeUndefined();
    expect(options.data).toEqual({
      inviterName: "Ada Lovelace",
      inviteLink: `https://transfer.example.com/register-with-invite/${result.token}`,
      expiresInMinutes: 15,
    });
  });

  it("falls back to the 'en' locale when the inviting admin has no locale set", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      firstName: "Grace",
      lastName: "Hopper",
      locale: null,
    } as never);
    vi.mocked(emailService.send).mockResolvedValue({ enqueued: true });

    await service.generateInviteToken("admin-1", "newcomer@example.com");

    expect(vi.mocked(emailService.send).mock.calls[0][1].locale).toBe("en");
  });

  it("reports emailSent: false when SMTP is off (send returns enqueued: false)", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      firstName: "Ada",
      lastName: "Lovelace",
      locale: "en",
    } as never);
    vi.mocked(emailService.send).mockResolvedValue({ enqueued: false });

    const result = await service.generateInviteToken("admin-1", "newcomer@example.com");

    expect(result.emailSent).toBe(false);
  });

  it("still returns the token (emailSent: false) when the email send throws", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      firstName: "Ada",
      lastName: "Lovelace",
      locale: "en",
    } as never);
    vi.mocked(emailService.send).mockRejectedValue(new Error("queue down"));

    const result = await service.generateInviteToken("admin-1", "newcomer@example.com");

    expect(result.token).toMatch(/^[0-9a-f]{64}$/);
    expect(result.emailSent).toBe(false);
  });

  it("binds the token to the invited email (lowercased) when an address is given (A6-04)", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      firstName: "Ada",
      lastName: "Lovelace",
      locale: "en",
    } as never);
    vi.mocked(emailService.send).mockResolvedValue({ enqueued: true });

    await service.generateInviteToken("admin-1", "Newcomer@Example.com");

    const created = vi.mocked(prisma.inviteToken.create).mock.calls[0][0].data;
    expect(created.email).toBe("newcomer@example.com");
  });

  it("stores a null email for open/bearer invites (no address) (A6-04)", async () => {
    await service.generateInviteToken("admin-1");

    const created = vi.mocked(prisma.inviteToken.create).mock.calls[0][0].data;
    expect(created.email).toBeNull();
  });
});

describe("InviteService.registerWithInvite — email binding (A6-04)", () => {
  const futureExpiry = new Date(Date.now() + 10 * 60 * 1000);

  function registrationData(email: string) {
    return {
      token: "tok-abc",
      firstName: "Mallory",
      lastName: "Example",
      username: "mallory",
      email,
      password: "correct-horse-battery-staple",
    };
  }

  it("rejects a mismatched email on an email-bound token before bcrypt (403)", async () => {
    vi.mocked(prisma.inviteToken.findUnique).mockResolvedValue({
      id: "invite-1",
      token: "tok-abc",
      email: "alice@corp.example",
      usedAt: null,
      expiresAt: futureExpiry,
    } as never);

    await expect(
      service.registerWithInvite(registrationData("mallory@evil.example")),
    ).rejects.toThrow(/different email address/i);

    // The claim/user-create transaction must never run for a mismatched email.
    expect(prisma.inviteToken.updateMany).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("accepts the bound email case-insensitively", async () => {
    vi.mocked(prisma.inviteToken.findUnique).mockResolvedValue({
      id: "invite-1",
      token: "tok-abc",
      email: "alice@corp.example",
      usedAt: null,
      expiresAt: futureExpiry,
    } as never);
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.inviteToken.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.user.create).mockResolvedValue({
      id: "user-1",
      username: "mallory",
      email: "alice@corp.example",
    } as never);

    const result = await service.registerWithInvite(registrationData("Alice@Corp.Example"));

    expect(result.id).toBe("user-1");
    expect(prisma.user.create).toHaveBeenCalledTimes(1);
  });

  it("accepts any email for an open/bearer token (email === null)", async () => {
    vi.mocked(prisma.inviteToken.findUnique).mockResolvedValue({
      id: "invite-1",
      token: "tok-abc",
      email: null,
      usedAt: null,
      expiresAt: futureExpiry,
    } as never);
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.inviteToken.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.user.create).mockResolvedValue({
      id: "user-2",
      username: "mallory",
      email: "anyone@example.com",
    } as never);

    const result = await service.registerWithInvite(registrationData("anyone@example.com"));

    expect(result.id).toBe("user-2");
  });
});
