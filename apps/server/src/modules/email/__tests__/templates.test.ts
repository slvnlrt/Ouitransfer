import { describe, expect, it } from "vitest";

import type { TranslationFn } from "../i18n/loader.js";
import { renderAccountDeactivated } from "../templates/account-deactivated.js";
import { renderAccountReactivated } from "../templates/account-reactivated.js";
import { renderAdminQuotaAlert } from "../templates/admin-quota-alert.js";
import { renderAdminUserRegistered } from "../templates/admin-user-registered.js";
import { renderFilesAutoDeleted } from "../templates/files-auto-deleted.js";
import { renderPasswordReset } from "../templates/password-reset.js";
import { renderQuotaExceeded } from "../templates/quota-exceeded.js";
import { renderQuotaWarning } from "../templates/quota-warning.js";
import { renderReverseShareExpired } from "../templates/reverse-share-expired.js";
import { renderReverseShareExpiring } from "../templates/reverse-share-expiring.js";
import { renderReverseShareInvitation } from "../templates/reverse-share-invitation.js";
import { renderReverseShareUploaded } from "../templates/reverse-share-uploaded.js";
import { renderShareAccessed } from "../templates/share-accessed.js";
import { renderShareAutoDeleted } from "../templates/share-auto-deleted.js";
import { renderShareDownloaded } from "../templates/share-downloaded.js";
import { renderShareExpired } from "../templates/share-expired.js";
import { renderShareExpiring } from "../templates/share-expiring.js";
import { renderShareInvitation } from "../templates/share-invitation.js";
import { renderShareMaxViewsReached } from "../templates/share-max-views-reached.js";
import { renderShareNoActivity } from "../templates/share-no-activity.js";
import { renderTestEmail } from "../templates/test-email.js";
import { renderWelcome } from "../templates/welcome.js";

// ─── Mock TranslationFn ───────────────────────────────────────────────────────

/**
 * Mock translation function that returns the key path so we can assert
 * which i18n keys are used, and the params so we can verify data is passed.
 */
const mockT: TranslationFn = (path, params) => {
  if (params && Object.keys(params).length > 0) {
    return `[${path}:${JSON.stringify(params)}]`;
  }
  return `[${path}]`;
};

// ─── Account lifecycle ────────────────────────────────────────────────────────

describe("renderWelcome", () => {
  it("returns valid LayoutSlots with subtitle and body", () => {
    const slots = renderWelcome(
      { firstName: "Alice", loginUrl: "https://example.com/login" },
      mockT,
    );
    expect(typeof slots.subtitle).toBe("string");
    expect(typeof slots.body).toBe("string");
    expect(slots.subtitle).toContain("welcome.subtitle");
  });

  it("includes firstName in body", () => {
    const slots = renderWelcome(
      { firstName: "Alice", loginUrl: "https://example.com/login" },
      mockT,
    );
    expect(slots.body).toContain("Alice");
    expect(slots.body).toContain("welcome.body");
  });

  it("returns CTA with loginUrl and label", () => {
    const slots = renderWelcome(
      { firstName: "Alice", loginUrl: "https://example.com/login" },
      mockT,
    );
    expect(slots.cta).toBeDefined();
    expect(slots.cta?.url).toBe("https://example.com/login");
    expect(slots.cta?.label).toContain("welcome.cta");
  });

  it("does not set unsubscribeUrl", () => {
    const slots = renderWelcome(
      { firstName: "Alice", loginUrl: "https://example.com/login" },
      mockT,
    );
    expect(slots.unsubscribeUrl).toBeUndefined();
  });

  it("interpolates appName into subtitle when provided via default params", () => {
    // Simulate a translation function that has appName as a default param
    // (as set up by createTranslationFn in service.ts)
    const trWithAppName: TranslationFn = (path, params) => {
      const strings: Record<string, string> = {
        "welcome.subtitle": "Welcome to {appName}",
        "welcome.body": "Hello {firstName},\n\nWelcome to {appName}!",
        "welcome.cta": "Sign in to {appName}",
      };
      let result = strings[path] ?? `[${path}]`;
      if (params) {
        for (const [key, value] of Object.entries(params)) {
          result = result.replaceAll(`{${key}}`, value);
        }
      }
      return result;
    };

    const slots = renderWelcome(
      { firstName: "Alice", loginUrl: "https://example.com/login" },
      trWithAppName,
    );

    // When appName is NOT passed, subtitle shows literal {appName}
    expect(slots.subtitle).toContain("{appName}");

    // Now simulate what service.ts does: merge appName into default params
    const trWithDefaults: TranslationFn = (path, params) => {
      return trWithAppName(path, { appName: "Ouitransfer", ...params });
    };

    const slotsWithDefaults = renderWelcome(
      { firstName: "Alice", loginUrl: "https://example.com/login" },
      trWithDefaults,
    );

    // With appName in defaults, subtitle is correctly interpolated
    expect(slotsWithDefaults.subtitle).toBe("Welcome to Ouitransfer");
    expect(slotsWithDefaults.subtitle).not.toContain("{appName}");
  });
});

describe("renderPasswordReset", () => {
  it("returns valid LayoutSlots", () => {
    const slots = renderPasswordReset(
      { resetUrl: "https://example.com/reset?t=xyz", expiresInMinutes: 30 },
      mockT,
    );
    expect(typeof slots.subtitle).toBe("string");
    expect(typeof slots.body).toBe("string");
  });

  it("includes expiresInMinutes as string in body", () => {
    const slots = renderPasswordReset(
      { resetUrl: "https://example.com/reset?t=xyz", expiresInMinutes: 30 },
      mockT,
    );
    expect(slots.body).toContain("30");
    expect(slots.body).toContain("passwordReset.body");
  });

  it("returns CTA with resetUrl", () => {
    const slots = renderPasswordReset(
      { resetUrl: "https://example.com/reset?t=xyz", expiresInMinutes: 30 },
      mockT,
    );
    expect(slots.cta?.url).toBe("https://example.com/reset?t=xyz");
  });

  it("returns infoBox", () => {
    const slots = renderPasswordReset(
      { resetUrl: "https://example.com/reset?t=xyz", expiresInMinutes: 30 },
      mockT,
    );
    expect(slots.infoBox).toBeDefined();
    expect(slots.infoBox).toContain("passwordReset.info");
  });
});

describe("renderAccountDeactivated", () => {
  it("returns valid LayoutSlots", () => {
    const slots = renderAccountDeactivated({ firstName: "Bob" }, mockT);
    expect(typeof slots.subtitle).toBe("string");
    expect(typeof slots.body).toBe("string");
  });

  it("includes firstName in body", () => {
    const slots = renderAccountDeactivated({ firstName: "Bob" }, mockT);
    expect(slots.body).toContain("Bob");
  });

  it("shows generic info when no adminContactEmail", () => {
    const slots = renderAccountDeactivated({ firstName: "Bob" }, mockT);
    expect(slots.infoBox).toContain("accountDeactivated.info");
    expect(slots.infoBox).not.toContain("infoContact");
  });

  it("shows contact info when adminContactEmail is provided", () => {
    const slots = renderAccountDeactivated(
      { firstName: "Bob", adminContactEmail: "admin@example.com" },
      mockT,
    );
    expect(slots.infoBox).toContain("accountDeactivated.infoContact");
    expect(slots.infoBox).toContain("admin@example.com");
  });
});

describe("renderAccountReactivated", () => {
  it("returns valid LayoutSlots with CTA", () => {
    const slots = renderAccountReactivated(
      { firstName: "Carol", loginUrl: "https://example.com/login" },
      mockT,
    );
    expect(typeof slots.subtitle).toBe("string");
    expect(typeof slots.body).toBe("string");
    expect(slots.cta?.url).toBe("https://example.com/login");
  });

  it("includes firstName in body", () => {
    const slots = renderAccountReactivated(
      { firstName: "Carol", loginUrl: "https://example.com/login" },
      mockT,
    );
    expect(slots.body).toContain("Carol");
  });
});

// ─── Share templates ──────────────────────────────────────────────────────────

describe("renderShareInvitation", () => {
  it("returns valid LayoutSlots with CTA", () => {
    const slots = renderShareInvitation(
      {
        senderName: "Alice",
        shareName: "Project Files",
        shareLink: "https://example.com/s/abc",
        hasPassword: false,
      },
      mockT,
    );
    expect(typeof slots.subtitle).toBe("string");
    expect(typeof slots.body).toBe("string");
    expect(slots.cta?.url).toBe("https://example.com/s/abc");
  });

  it("includes senderName and shareName in body", () => {
    const slots = renderShareInvitation(
      {
        senderName: "Alice",
        shareName: "Project Files",
        shareLink: "https://example.com/s/abc",
        hasPassword: false,
      },
      mockT,
    );
    expect(slots.body).toContain("Alice");
    expect(slots.body).toContain("Project Files");
  });

  it("shows infoPassword when hasPassword is true", () => {
    const slots = renderShareInvitation(
      {
        senderName: "Alice",
        shareName: "Secret Files",
        shareLink: "https://example.com/s/xyz",
        hasPassword: true,
      },
      mockT,
    );
    expect(slots.infoBox).toContain("shareInvitation.infoPassword");
  });

  it("shows infoExpires when hasPassword is false and expiresAt is set", () => {
    const slots = renderShareInvitation(
      {
        senderName: "Alice",
        shareName: "Expiring Files",
        shareLink: "https://example.com/s/xyz",
        hasPassword: false,
        expiresAt: "2026-12-31T00:00:00.000Z",
      },
      mockT,
    );
    expect(slots.infoBox).toContain("shareInvitation.infoExpires");
    expect(slots.infoBox).toContain("2026-12-31T00:00:00.000Z");
  });

  it("shows default info when no password and no expiry", () => {
    const slots = renderShareInvitation(
      {
        senderName: "Alice",
        shareName: "Files",
        shareLink: "https://example.com/s/xyz",
        hasPassword: false,
      },
      mockT,
    );
    expect(slots.infoBox).toContain("shareInvitation.info");
    expect(slots.infoBox).not.toContain("infoPassword");
    expect(slots.infoBox).not.toContain("infoExpires");
  });
});

describe("renderShareAccessed", () => {
  it("uses bodyIdentified when visitorName is provided", () => {
    const slots = renderShareAccessed(
      {
        shareName: "My Files",
        visitorName: "John",
        accessedAt: "2026-05-01T10:00:00Z",
      },
      mockT,
    );
    expect(slots.body).toContain("shareAccessed.bodyIdentified");
    expect(slots.body).toContain("John");
    expect(slots.subtitle).toContain("shareAccessed.subtitle");
  });

  it("uses bodyIdentified when visitorEmail is provided (no name)", () => {
    const slots = renderShareAccessed(
      {
        shareName: "My Files",
        visitorEmail: "john@example.com",
        accessedAt: "2026-05-01T10:00:00Z",
      },
      mockT,
    );
    expect(slots.body).toContain("shareAccessed.bodyIdentified");
    expect(slots.body).toContain("john@example.com");
  });

  it("uses bodyAnonymous when no visitorName or visitorEmail", () => {
    const slots = renderShareAccessed(
      {
        shareName: "My Files",
        accessedAt: "2026-05-01T10:00:00Z",
      },
      mockT,
    );
    expect(slots.body).toContain("shareAccessed.bodyAnonymous");
    expect(slots.body).not.toContain("bodyIdentified");
  });

  it("does not set CTA", () => {
    const slots = renderShareAccessed(
      { shareName: "My Files", accessedAt: "2026-05-01T10:00:00Z" },
      mockT,
    );
    expect(slots.cta).toBeUndefined();
  });
});

describe("renderShareDownloaded", () => {
  it("uses bodyIdentified when visitorName is provided", () => {
    const slots = renderShareDownloaded(
      {
        shareName: "My Share",
        fileName: "document.pdf",
        visitorName: "Jane",
        downloadedAt: "2026-05-01T10:00:00Z",
      },
      mockT,
    );
    expect(slots.body).toContain("shareDownloaded.bodyIdentified");
    expect(slots.body).toContain("Jane");
    expect(slots.body).toContain("document.pdf");
  });

  it("uses bodyAnonymous when no visitor info", () => {
    const slots = renderShareDownloaded(
      {
        shareName: "My Share",
        fileName: "photo.jpg",
        downloadedAt: "2026-05-01T10:00:00Z",
      },
      mockT,
    );
    expect(slots.body).toContain("shareDownloaded.bodyAnonymous");
    expect(slots.body).toContain("photo.jpg");
  });
});

describe("renderShareExpiring", () => {
  it("returns valid LayoutSlots with CTA", () => {
    const slots = renderShareExpiring(
      {
        shareName: "My Share",
        expiresAt: "2026-12-31T00:00:00.000Z",
        shareManageUrl: "https://example.com/manage",
      },
      mockT,
    );
    expect(typeof slots.subtitle).toBe("string");
    expect(typeof slots.body).toBe("string");
    expect(slots.cta?.url).toBe("https://example.com/manage");
    expect(slots.body).toContain("My Share");
    expect(slots.body).toContain("2026-12-31T00:00:00.000Z");
  });
});

describe("renderShareExpired", () => {
  it("returns valid LayoutSlots with CTA", () => {
    const slots = renderShareExpired(
      {
        shareName: "Old Share",
        expiredAt: "2026-01-01T00:00:00.000Z",
        shareManageUrl: "https://example.com/manage",
      },
      mockT,
    );
    expect(typeof slots.subtitle).toBe("string");
    expect(typeof slots.body).toBe("string");
    expect(slots.cta?.url).toBe("https://example.com/manage");
    expect(slots.body).toContain("Old Share");
    expect(slots.body).toContain("2026-01-01T00:00:00.000Z");
  });
});

describe("renderShareMaxViewsReached", () => {
  it("returns valid LayoutSlots with CTA and includes maxViews as string", () => {
    const slots = renderShareMaxViewsReached(
      {
        shareName: "Popular Share",
        maxViews: 100,
        shareManageUrl: "https://example.com/manage",
      },
      mockT,
    );
    expect(typeof slots.subtitle).toBe("string");
    expect(typeof slots.body).toBe("string");
    expect(slots.cta?.url).toBe("https://example.com/manage");
    expect(slots.body).toContain("100");
    expect(slots.body).toContain("Popular Share");
  });
});

describe("renderShareNoActivity", () => {
  it("returns valid LayoutSlots with CTA and includes inactivityDays as string", () => {
    const slots = renderShareNoActivity(
      {
        shareName: "Quiet Share",
        inactivityDays: 30,
        shareManageUrl: "https://example.com/manage",
      },
      mockT,
    );
    expect(typeof slots.subtitle).toBe("string");
    expect(typeof slots.body).toBe("string");
    expect(slots.cta?.url).toBe("https://example.com/manage");
    expect(slots.body).toContain("30");
    expect(slots.body).toContain("Quiet Share");
  });
});

// ─── Reverse share templates ──────────────────────────────────────────────────

describe("renderReverseShareInvitation", () => {
  it("returns valid LayoutSlots with CTA", () => {
    const slots = renderReverseShareInvitation(
      {
        senderName: "Alice",
        reverseShareName: "Project Upload",
        reverseShareLink: "https://example.com/r/abc",
        hasPassword: false,
      },
      mockT,
    );
    expect(typeof slots.subtitle).toBe("string");
    expect(typeof slots.body).toBe("string");
    expect(slots.cta?.url).toBe("https://example.com/r/abc");
    expect(slots.body).toContain("Alice");
    expect(slots.body).toContain("Project Upload");
  });

  it("shows infoPassword when hasPassword is true", () => {
    const slots = renderReverseShareInvitation(
      {
        senderName: "Alice",
        reverseShareName: "Secret Upload",
        reverseShareLink: "https://example.com/r/xyz",
        hasPassword: true,
      },
      mockT,
    );
    expect(slots.infoBox).toContain("reverseShareInvitation.infoPassword");
  });

  it("shows infoExpires when no password and expiresAt is set", () => {
    const slots = renderReverseShareInvitation(
      {
        senderName: "Alice",
        reverseShareName: "Temp Upload",
        reverseShareLink: "https://example.com/r/xyz",
        hasPassword: false,
        expiresAt: "2026-06-30T00:00:00.000Z",
      },
      mockT,
    );
    expect(slots.infoBox).toContain("reverseShareInvitation.infoExpires");
    expect(slots.infoBox).toContain("2026-06-30T00:00:00.000Z");
  });
});

describe("renderReverseShareUploaded", () => {
  it("uses bodyIdentified when uploaderName is provided", () => {
    const slots = renderReverseShareUploaded(
      {
        reverseShareName: "Project Upload",
        fileCount: 2,
        fileNames: ["doc.pdf", "image.jpg"],
        uploaderName: "Bob",
      },
      mockT,
    );
    expect(slots.body).toContain("reverseShareUploaded.bodyIdentified");
    expect(slots.body).toContain("Bob");
    expect(slots.body).toContain("2");
    expect(slots.body).toContain("doc.pdf");
  });

  it("uses bodyAnonymous when no uploader info", () => {
    const slots = renderReverseShareUploaded(
      {
        reverseShareName: "Project Upload",
        fileCount: 1,
        fileNames: ["file.txt"],
      },
      mockT,
    );
    expect(slots.body).toContain("reverseShareUploaded.bodyAnonymous");
    expect(slots.body).toContain("file.txt");
  });

  it("uses uploaderEmail as fallback when uploaderName is absent", () => {
    const slots = renderReverseShareUploaded(
      {
        reverseShareName: "Project Upload",
        fileCount: 1,
        fileNames: ["file.txt"],
        uploaderEmail: "uploader@example.com",
      },
      mockT,
    );
    expect(slots.body).toContain("reverseShareUploaded.bodyIdentified");
    expect(slots.body).toContain("uploader@example.com");
  });
});

describe("renderReverseShareExpiring", () => {
  it("returns valid LayoutSlots without CTA", () => {
    const slots = renderReverseShareExpiring(
      { reverseShareName: "My Request", expiresAt: "2026-06-30T00:00:00.000Z" },
      mockT,
    );
    expect(typeof slots.subtitle).toBe("string");
    expect(typeof slots.body).toBe("string");
    expect(slots.body).toContain("My Request");
    expect(slots.body).toContain("2026-06-30T00:00:00.000Z");
    expect(slots.cta).toBeUndefined();
  });
});

describe("renderReverseShareExpired", () => {
  it("returns valid LayoutSlots without CTA", () => {
    const slots = renderReverseShareExpired(
      { reverseShareName: "Old Request", expiredAt: "2026-01-01T00:00:00.000Z" },
      mockT,
    );
    expect(typeof slots.subtitle).toBe("string");
    expect(typeof slots.body).toBe("string");
    expect(slots.body).toContain("Old Request");
    expect(slots.body).toContain("2026-01-01T00:00:00.000Z");
    expect(slots.cta).toBeUndefined();
  });
});

// ─── Admin templates ──────────────────────────────────────────────────────────

describe("renderAdminUserRegistered", () => {
  it("returns valid LayoutSlots with all user info", () => {
    const slots = renderAdminUserRegistered(
      {
        userName: "Dave",
        userEmail: "dave@example.com",
        registrationMethod: "email",
      },
      mockT,
    );
    expect(typeof slots.subtitle).toBe("string");
    expect(typeof slots.body).toBe("string");
    expect(slots.body).toContain("Dave");
    expect(slots.body).toContain("dave@example.com");
    expect(slots.body).toContain("email");
  });

  it("does not set CTA or infoBox", () => {
    const slots = renderAdminUserRegistered(
      { userName: "Dave", userEmail: "dave@example.com", registrationMethod: "ldap" },
      mockT,
    );
    expect(slots.cta).toBeUndefined();
    expect(slots.infoBox).toBeUndefined();
  });
});

describe("renderAdminQuotaAlert", () => {
  it("returns valid LayoutSlots with infoBox", () => {
    const slots = renderAdminQuotaAlert(
      {
        userName: "Eve",
        userEmail: "eve@example.com",
        usedPercent: 95,
        usedBytes: 9_500_000_000,
        maxBytes: 10_000_000_000,
      },
      mockT,
    );
    expect(typeof slots.subtitle).toBe("string");
    expect(typeof slots.body).toBe("string");
    expect(slots.infoBox).toBeDefined();
    expect(slots.body).toContain("95");
    expect(slots.body).toContain("Eve");
    expect(slots.infoBox).toContain("95");
  });
});

// ─── Test email ───────────────────────────────────────────────────────────────

describe("renderTestEmail", () => {
  it("returns valid LayoutSlots without custom message", () => {
    const slots = renderTestEmail({}, mockT);
    expect(typeof slots.subtitle).toBe("string");
    expect(typeof slots.body).toBe("string");
    expect(slots.infoBox).toBeDefined();
    expect(slots.body).toContain("testEmail.body");
  });

  it("uses bodyCustom when testMessage is provided", () => {
    const slots = renderTestEmail({ testMessage: "Hello from test!" }, mockT);
    expect(slots.body).toContain("testEmail.bodyCustom");
    expect(slots.body).toContain("Hello from test!");
  });

  it("does not set CTA", () => {
    const slots = renderTestEmail({}, mockT);
    expect(slots.cta).toBeUndefined();
  });
});

// ─── Deferred (5.2) templates ─────────────────────────────────────────────────

describe("renderQuotaWarning", () => {
  it("returns valid LayoutSlots with infoBox", () => {
    const slots = renderQuotaWarning(
      { usedPercent: 80, usedBytes: 8_000_000_000, maxBytes: 10_000_000_000 },
      mockT,
    );
    expect(typeof slots.subtitle).toBe("string");
    expect(typeof slots.body).toBe("string");
    expect(slots.infoBox).toBeDefined();
    expect(slots.body).toContain("80");
  });
});

describe("renderQuotaExceeded", () => {
  it("uses body (no grace period) when gracePeriodDays is undefined", () => {
    const slots = renderQuotaExceeded(
      { usedBytes: 11_000_000_000, maxBytes: 10_000_000_000 },
      mockT,
    );
    expect(slots.body).toContain("quotaExceeded.body");
    expect(slots.body).not.toContain("bodyGrace");
    expect(slots.infoBox).toBeDefined();
  });

  it("uses bodyGrace when gracePeriodDays is set", () => {
    const slots = renderQuotaExceeded(
      { usedBytes: 11_000_000_000, maxBytes: 10_000_000_000, gracePeriodDays: 7 },
      mockT,
    );
    expect(slots.body).toContain("quotaExceeded.bodyGrace");
    expect(slots.body).toContain("7");
  });
});

describe("renderFilesAutoDeleted", () => {
  it("returns valid LayoutSlots with file list and reason", () => {
    const slots = renderFilesAutoDeleted(
      { fileNames: ["old-file.zip", "backup.tar.gz"], reason: "expired" },
      mockT,
    );
    expect(typeof slots.subtitle).toBe("string");
    expect(typeof slots.body).toBe("string");
    expect(slots.infoBox).toBeDefined();
    expect(slots.body).toContain("old-file.zip");
    expect(slots.body).toContain("backup.tar.gz");
    expect(slots.body).toContain("expired");
  });
});

describe("renderShareAutoDeleted", () => {
  it("returns valid LayoutSlots with shareName and reason", () => {
    const slots = renderShareAutoDeleted(
      { shareName: "Ancient Share", reason: "inactivity" },
      mockT,
    );
    expect(typeof slots.subtitle).toBe("string");
    expect(typeof slots.body).toBe("string");
    expect(slots.infoBox).toBeDefined();
    expect(slots.body).toContain("Ancient Share");
    expect(slots.body).toContain("inactivity");
  });
});
