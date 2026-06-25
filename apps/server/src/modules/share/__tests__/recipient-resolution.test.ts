/**
 * recipient-resolution.test.ts
 *
 * Unit tests for the shared download/access recipient resolver (8.3 Batch 1, lot C).
 *
 * Trust ladder asserted here:
 *  - cookie.recipientId present & belongs to the share  → "token"
 *  - cookie.recipientId present but wrong share          → rejected, falls through to email
 *  - cookie.email matches a recipient                    → "self_declared"
 *  - cookie.email absent (name-only) / no match / no cookie → null
 *  - spoof-labeling: an arbitrary email that happens to match is "self_declared", never "token"
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRecipientFindUnique } = vi.hoisted(() => ({
  mockRecipientFindUnique: vi.fn(),
}));

vi.mock("../../../shared/prisma.js", () => ({
  prisma: {
    shareRecipient: { findUnique: mockRecipientFindUnique },
    shareAlias: { findUnique: vi.fn() },
  },
}));

import { resolveDownloadRecipient } from "../recipient-resolution.js";

const SHARE_ID = "share-1";

describe("resolveDownloadRecipient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when cookie is undefined (anonymous)", async () => {
    const result = await resolveDownloadRecipient({ shareId: SHARE_ID, cookie: undefined });
    expect(result).toBeNull();
    expect(mockRecipientFindUnique).not.toHaveBeenCalled();
  });

  it("resolves a token-verified recipientId that belongs to the share as 'token'", async () => {
    mockRecipientFindUnique.mockResolvedValueOnce({ id: "rec-1", shareId: SHARE_ID });
    const result = await resolveDownloadRecipient({
      shareId: SHARE_ID,
      cookie: { recipientId: "rec-1" },
    });
    expect(result).toEqual({ recipientId: "rec-1", identificationSource: "token" });
    expect(mockRecipientFindUnique).toHaveBeenCalledWith({
      where: { id: "rec-1" },
      select: { id: true, shareId: true },
    });
  });

  it("rejects a recipientId from a different share and falls through to null without email", async () => {
    mockRecipientFindUnique.mockResolvedValueOnce({ id: "rec-1", shareId: "other-share" });
    const result = await resolveDownloadRecipient({
      shareId: SHARE_ID,
      cookie: { recipientId: "rec-1" },
    });
    expect(result).toBeNull();
  });

  it("falls through from a wrong-share recipientId to a matching email (self_declared)", async () => {
    mockRecipientFindUnique
      .mockResolvedValueOnce({ id: "rec-1", shareId: "other-share" }) // token id rejected
      .mockResolvedValueOnce({ id: "rec-2" }); // email hit
    const result = await resolveDownloadRecipient({
      shareId: SHARE_ID,
      cookie: { recipientId: "rec-1", email: "Bob@Example.com" },
    });
    expect(result).toEqual({ recipientId: "rec-2", identificationSource: "self_declared" });
  });

  it("resolves a matching self-declared email as 'self_declared' (normalized lower/trim)", async () => {
    mockRecipientFindUnique.mockResolvedValueOnce({ id: "rec-2" });
    const result = await resolveDownloadRecipient({
      shareId: SHARE_ID,
      cookie: { email: "  Bob@Example.COM " },
    });
    expect(result).toEqual({ recipientId: "rec-2", identificationSource: "self_declared" });
    expect(mockRecipientFindUnique).toHaveBeenCalledWith({
      where: { shareId_email: { shareId: SHARE_ID, email: "bob@example.com" } },
      select: { id: true },
    });
  });

  it("spoof-labeling: a known recipient's email typed by anyone resolves to 'self_declared', never 'token'", async () => {
    mockRecipientFindUnique.mockResolvedValueOnce({ id: "rec-known" });
    const result = await resolveDownloadRecipient({
      shareId: SHARE_ID,
      cookie: { email: "known.recipient@example.com" },
    });
    expect(result?.identificationSource).toBe("self_declared");
    expect(result?.identificationSource).not.toBe("token");
  });

  it("returns null for a name-only cookie (no email, no recipientId)", async () => {
    const result = await resolveDownloadRecipient({
      shareId: SHARE_ID,
      cookie: { email: undefined },
    });
    expect(result).toBeNull();
    expect(mockRecipientFindUnique).not.toHaveBeenCalled();
  });

  it("returns null when the self-declared email matches no recipient of the share", async () => {
    mockRecipientFindUnique.mockResolvedValueOnce(null);
    const result = await resolveDownloadRecipient({
      shareId: SHARE_ID,
      cookie: { email: "nobody@example.com" },
    });
    expect(result).toBeNull();
  });
});
