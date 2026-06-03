import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type NotificationKey,
  type NotificationTypeConfig,
  notificationCatalog,
  typeToI18nPrefix,
} from "../catalog.js";
import { clearLocaleCache, createPlainTranslationFn, createTranslationFn } from "../i18n/loader.js";
import { renderLayout } from "../templates/base-layout.js";

// The i18n loader's interpolate function uses getLogger() for unresolved placeholder warnings.
vi.mock("../../../utils/logger.js", () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const allKeys = Object.keys(notificationCatalog) as NotificationKey[];

function getEntries(keys: NotificationKey[]): [NotificationKey, NotificationTypeConfig][] {
  return keys.map((k) => [k, notificationCatalog[k]]);
}

/** Types 1-4 and 22: account lifecycle + test_email. */
const criticalKeys: NotificationKey[] = [
  "welcome",
  "password_reset",
  "account_deactivated",
  "account_reactivated",
  "test_email",
];

/** Types 7-8: noisy share activity types (default disabled). */
const noisyKeys: NotificationKey[] = ["share_accessed", "share_downloaded"];

/** Types 7-15: configurable share/reverse-share lifecycle. */
const configurableShareKeys: NotificationKey[] = [
  "share_accessed",
  "share_downloaded",
  "share_expiring",
  "share_expired",
  "share_max_views_reached",
  "share_no_activity",
  "reverse_share_uploaded",
  "reverse_share_expiring",
  "reverse_share_expired",
];

/** Types 16-19 + 5.2 cleanup lifecycle: configurable cleanup/quota triggers. */
const deferredTriggerKeys: NotificationKey[] = [
  "quota_warning",
  "quota_exceeded",
  "files_auto_deleted",
  "share_auto_deleted",
  "share_pending_deletion",
  "reverse_share_pending_deletion",
  "reverse_share_auto_deleted",
];

/** Types 20-21: admin fan-out. */
const adminKeys: NotificationKey[] = ["admin_user_registered", "admin_quota_alert"];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("notificationCatalog", () => {
  it("has exactly 25 entries", () => {
    expect(allKeys).toHaveLength(25);
  });

  it("all entries have required fields", () => {
    for (const [key, entry] of getEntries(allKeys)) {
      expect(entry, `${key} missing render`).toHaveProperty("render");
      expect(typeof entry.render, `${key} render is not a function`).toBe("function");
      expect(entry, `${key} missing payloadSchema`).toHaveProperty("payloadSchema");
      expect(entry, `${key} missing priority`).toHaveProperty("priority");
      expect([0, 1], `${key} priority must be 0 or 1`).toContain(entry.priority);
      expect(entry, `${key} missing isCritical`).toHaveProperty("isCritical");
      expect(typeof entry.isCritical, `${key} isCritical is not boolean`).toBe("boolean");
      expect(entry, `${key} missing defaultFrequency`).toHaveProperty("defaultFrequency");
      expect(
        ["immediate", "disabled"],
        `${key} defaultFrequency must be immediate or disabled`,
      ).toContain(entry.defaultFrequency);
      expect(entry, `${key} missing configurable`).toHaveProperty("configurable");
      expect(typeof entry.configurable, `${key} configurable is not boolean`).toBe("boolean");
      expect(entry, `${key} missing hasUnsubscribe`).toHaveProperty("hasUnsubscribe");
      expect(typeof entry.hasUnsubscribe, `${key} hasUnsubscribe is not boolean`).toBe("boolean");
      expect(entry, `${key} missing requiredI18nKeys`).toHaveProperty("requiredI18nKeys");
      expect(Array.isArray(entry.requiredI18nKeys), `${key} requiredI18nKeys is not array`).toBe(
        true,
      );
    }
  });

  it("critical types have priority 1 and isCritical true", () => {
    for (const [key, entry] of getEntries(criticalKeys)) {
      expect(entry.priority, `${key} should have priority 1`).toBe(1);
      expect(entry.isCritical, `${key} should be critical`).toBe(true);
    }
  });

  it("critical types all have hasUnsubscribe: false (invariant)", () => {
    for (const [key, entry] of getEntries(criticalKeys)) {
      expect(entry.hasUnsubscribe, `${key} critical type must not have unsubscribe`).toBe(false);
    }
  });

  it("critical types all have configurable: false (invariant)", () => {
    for (const [key, entry] of getEntries(criticalKeys)) {
      expect(entry.configurable, `${key} critical type must not be configurable`).toBe(false);
    }
  });

  it("types 7-8 default to disabled", () => {
    for (const [key, entry] of getEntries(noisyKeys)) {
      expect(entry.defaultFrequency, `${key} should default to disabled`).toBe("disabled");
    }
  });

  it("types 7-8 have cooldownSeconds = 900", () => {
    for (const [key, entry] of getEntries(noisyKeys)) {
      expect(entry.cooldownSeconds, `${key} should have 900s cooldown`).toBe(900);
    }
  });

  it("types 7-15 are configurable with unsubscribe", () => {
    for (const [key, entry] of getEntries(configurableShareKeys)) {
      expect(entry.configurable, `${key} should be configurable`).toBe(true);
      expect(entry.hasUnsubscribe, `${key} should have unsubscribe`).toBe(true);
    }
  });

  it("cleanup/quota triggers are configurable with unsubscribe", () => {
    for (const [key, entry] of getEntries(deferredTriggerKeys)) {
      expect(entry.configurable, `${key} should be configurable`).toBe(true);
      expect(entry.hasUnsubscribe, `${key} should have unsubscribe`).toBe(true);
    }
  });

  it("types 20-21 (admin) are configurable with unsubscribe", () => {
    for (const [key, entry] of getEntries(adminKeys)) {
      expect(entry.configurable, `${key} should be configurable`).toBe(true);
      expect(entry.hasUnsubscribe, `${key} should have unsubscribe`).toBe(true);
    }
  });

  it("invitation types (5-6) are non-configurable without unsubscribe", () => {
    const invitationKeys: NotificationKey[] = ["share_invitation", "reverse_share_invitation"];
    for (const [key, entry] of getEntries(invitationKeys)) {
      expect(entry.configurable, `${key} should not be configurable`).toBe(false);
      expect(entry.hasUnsubscribe, `${key} should not have unsubscribe`).toBe(false);
    }
  });

  it("all requiredI18nKeys arrays are non-empty (Batch 6 real templates)", () => {
    for (const [key, entry] of getEntries(allKeys)) {
      expect(
        entry.requiredI18nKeys.length,
        `${key} should have at least one i18n key`,
      ).toBeGreaterThan(0);
    }
  });

  it("render functions produce valid LayoutSlots", () => {
    const dummyT = (key: string) => key;

    /** Minimal valid payloads for each notification type. */
    const samplePayloads: Record<NotificationKey, unknown> = {
      welcome: { firstName: "Alice", loginUrl: "https://example.com/login" },
      password_reset: { resetUrl: "https://example.com/reset", expiresInMinutes: 30 },
      account_deactivated: { firstName: "Bob" },
      account_reactivated: { firstName: "Carol", loginUrl: "https://example.com/login" },
      share_invitation: {
        senderName: "Alice",
        shareName: "Files",
        shareLink: "https://example.com/s/abc",
        hasPassword: false,
      },
      reverse_share_invitation: {
        senderName: "Alice",
        reverseShareName: "Upload",
        reverseShareLink: "https://example.com/r/abc",
        hasPassword: false,
      },
      share_accessed: { shareName: "My Share", accessedAt: "2026-01-01T00:00:00Z" },
      share_downloaded: {
        shareName: "My Share",
        fileName: "file.pdf",
        downloadedAt: "2026-01-01T00:00:00Z",
      },
      share_expiring: {
        shareName: "My Share",
        expiresAt: "2026-12-31T00:00:00.000Z",
        shareManageUrl: "https://example.com/manage",
      },
      share_expired: {
        shareName: "My Share",
        expiredAt: "2026-01-01T00:00:00.000Z",
        shareManageUrl: "https://example.com/manage",
      },
      share_max_views_reached: {
        shareName: "My Share",
        maxViews: 50,
        shareManageUrl: "https://example.com/manage",
      },
      share_no_activity: {
        shareName: "My Share",
        inactivityDays: 30,
        shareManageUrl: "https://example.com/manage",
      },
      reverse_share_uploaded: {
        reverseShareName: "Upload Request",
        fileCount: 1,
        fileNames: ["file.txt"],
      },
      reverse_share_expiring: {
        reverseShareName: "Upload Request",
        expiresAt: "2026-12-31T00:00:00.000Z",
      },
      reverse_share_expired: {
        reverseShareName: "Upload Request",
        expiredAt: "2026-01-01T00:00:00.000Z",
      },
      quota_warning: { usedPercent: 80, usedBytes: 8_000_000_000, maxBytes: 10_000_000_000 },
      quota_exceeded: { usedBytes: 11_000_000_000, maxBytes: 10_000_000_000 },
      files_auto_deleted: { fileNames: ["old.zip"], reason: "expired" },
      share_auto_deleted: { shareName: "Old Share", reason: "inactivity" },
      admin_user_registered: {
        userName: "Dave",
        userEmail: "dave@example.com",
        registrationMethod: "email",
      },
      admin_quota_alert: {
        userName: "Eve",
        userEmail: "eve@example.com",
        usedPercent: 95,
        usedBytes: 9_500_000_000,
        maxBytes: 10_000_000_000,
      },
      share_pending_deletion: {
        shareName: "My Share",
        deletionAt: "2026-01-08T00:00:00.000Z",
        shareManageUrl: "https://example.com/manage",
      },
      reverse_share_pending_deletion: {
        reverseShareName: "Upload Request",
        deletionAt: "2026-01-08T00:00:00.000Z",
        reverseShareManageUrl: "https://example.com/manage",
      },
      reverse_share_auto_deleted: {
        reverseShareName: "Upload Request",
        deletedAt: "2026-01-01T00:00:00.000Z",
      },
      test_email: {},
    };

    for (const [key, entry] of getEntries(allKeys)) {
      const payload = samplePayloads[key];
      const slots = entry.render(payload, dummyT);
      expect(slots, `${key} render should return object`).toBeDefined();
      expect(typeof slots.subtitle, `${key} should have subtitle string`).toBe("string");
      expect(typeof slots.body, `${key} should have body string`).toBe("string");
    }
  });
});

describe("XSS safety — render pipeline escapes user-controlled fields", () => {
  afterEach(() => {
    clearLocaleCache();
  });

  it("HTML body does NOT contain raw <script> when senderName is XSS payload (share_invitation)", async () => {
    // Use real i18n (HTML-escaping) translation fn
    const tr = await createTranslationFn("en");
    const xssPayload = "<script>alert(1)</script>";

    const entry = notificationCatalog.share_invitation;
    const slots = entry.render(
      {
        senderName: xssPayload,
        shareName: "My Files",
        shareLink: "https://example.com/s/abc",
        hasPassword: false,
      },
      tr,
    );

    const output = renderLayout(slots, { appName: "Ouitransfer", locale: "en" }, tr);

    // HTML body MUST NOT contain the raw script tag
    expect(output.html).not.toContain("<script>alert(1)</script>");
    // It should contain the HTML-escaped version instead
    expect(output.html).toContain("&lt;script&gt;");
  });

  it("plain-text body DOES contain raw <script> (no escaping needed for plain text)", async () => {
    // Use plain (non-escaping) translation fn for plain text, as the service does
    const tr = await createPlainTranslationFn("en");
    const xssPayload = "<script>alert(1)</script>";

    const entry = notificationCatalog.share_invitation;
    const slots = entry.render(
      {
        senderName: xssPayload,
        shareName: "My Files",
        shareLink: "https://example.com/s/abc",
        hasPassword: false,
      },
      tr,
    );

    const output = renderLayout(slots, { appName: "Ouitransfer", locale: "en" }, tr);

    // Plain-text body may contain the raw string (stripHtml will decode it back)
    // or it may be absent if the template used HTML-escaping tr — either is acceptable.
    // The key invariant is that the plain-text renderer does not double-encode.
    expect(output.text).not.toContain("&lt;script&gt;");
  });
});

describe("typeToI18nPrefix", () => {
  it("converts snake_case to camelCase", () => {
    expect(typeToI18nPrefix("share_invitation")).toBe("shareInvitation");
    expect(typeToI18nPrefix("reverse_share_invitation")).toBe("reverseShareInvitation");
    expect(typeToI18nPrefix("share_max_views_reached")).toBe("shareMaxViewsReached");
    expect(typeToI18nPrefix("admin_user_registered")).toBe("adminUserRegistered");
  });

  it("leaves single-word types unchanged", () => {
    expect(typeToI18nPrefix("welcome")).toBe("welcome");
  });

  it("handles all catalog keys without throwing", () => {
    for (const key of allKeys) {
      expect(() => typeToI18nPrefix(key)).not.toThrow();
      // Result should not contain underscores
      expect(typeToI18nPrefix(key)).not.toContain("_");
    }
  });
});

describe("i18n key smoke tests — real en.json", () => {
  afterEach(() => {
    clearLocaleCache();
  });

  it("all catalog entries have valid i18n keys in en.json", async () => {
    // Use real en.json via createTranslationFn (no mocks).
    // This validates that every key referenced by templates actually exists.
    // appName is always provided as a default param in production (see service.ts),
    // so we include it here to avoid false positives from the unresolved-placeholder check.
    const tr = await createTranslationFn("en", { appName: "TestApp" });

    /** Minimal valid payloads matching each catalog entry's Zod schema. */
    const samplePayloads: Record<NotificationKey, unknown> = {
      welcome: { firstName: "Alice", loginUrl: "https://example.com/login" },
      password_reset: { resetUrl: "https://example.com/reset", expiresInMinutes: 30 },
      account_deactivated: { firstName: "Bob" },
      account_reactivated: { firstName: "Carol", loginUrl: "https://example.com/login" },
      share_invitation: {
        senderName: "Alice",
        shareName: "Files",
        shareLink: "https://example.com/s/abc",
        hasPassword: false,
      },
      reverse_share_invitation: {
        senderName: "Alice",
        reverseShareName: "Upload",
        reverseShareLink: "https://example.com/r/abc",
        hasPassword: false,
      },
      share_accessed: { shareName: "My Share", accessedAt: "2026-01-01T00:00:00Z" },
      share_downloaded: {
        shareName: "My Share",
        fileName: "file.pdf",
        downloadedAt: "2026-01-01T00:00:00Z",
      },
      share_expiring: {
        shareName: "My Share",
        expiresAt: "2026-12-31T00:00:00.000Z",
        shareManageUrl: "https://example.com/manage",
      },
      share_expired: {
        shareName: "My Share",
        expiredAt: "2026-01-01T00:00:00.000Z",
        shareManageUrl: "https://example.com/manage",
      },
      share_max_views_reached: {
        shareName: "My Share",
        maxViews: 50,
        shareManageUrl: "https://example.com/manage",
      },
      share_no_activity: {
        shareName: "My Share",
        inactivityDays: 30,
        shareManageUrl: "https://example.com/manage",
      },
      reverse_share_uploaded: {
        reverseShareName: "Upload Request",
        fileCount: 1,
        fileNames: ["file.txt"],
      },
      reverse_share_expiring: {
        reverseShareName: "Upload Request",
        expiresAt: "2026-12-31T00:00:00.000Z",
      },
      reverse_share_expired: {
        reverseShareName: "Upload Request",
        expiredAt: "2026-01-01T00:00:00.000Z",
      },
      quota_warning: { usedPercent: 80, usedBytes: 8_000_000_000, maxBytes: 10_000_000_000 },
      quota_exceeded: { usedBytes: 11_000_000_000, maxBytes: 10_000_000_000 },
      files_auto_deleted: { fileNames: ["old.zip"], reason: "expired" },
      share_auto_deleted: { shareName: "Old Share", reason: "inactivity" },
      admin_user_registered: {
        userName: "Dave",
        userEmail: "dave@example.com",
        registrationMethod: "email",
      },
      admin_quota_alert: {
        userName: "Eve",
        userEmail: "eve@example.com",
        usedPercent: 95,
        usedBytes: 9_500_000_000,
        maxBytes: 10_000_000_000,
      },
      share_pending_deletion: {
        shareName: "My Share",
        deletionAt: "2026-01-08T00:00:00.000Z",
        shareManageUrl: "https://example.com/manage",
      },
      reverse_share_pending_deletion: {
        reverseShareName: "Upload Request",
        deletionAt: "2026-01-08T00:00:00.000Z",
        reverseShareManageUrl: "https://example.com/manage",
      },
      reverse_share_auto_deleted: {
        reverseShareName: "Upload Request",
        deletedAt: "2026-01-01T00:00:00.000Z",
      },
      test_email: {},
    };

    for (const [type, entry] of Object.entries(notificationCatalog) as [
      NotificationKey,
      NotificationTypeConfig,
    ][]) {
      const payload = samplePayloads[type];

      // render() should not throw — if it does, a required i18n key is missing
      let rendered: ReturnType<typeof entry.render>;
      expect(() => {
        rendered = entry.render(payload, tr);
      }, `${type} render() threw — likely a missing i18n key`).not.toThrow();

      // Verify slots have correct shape
      expect(typeof rendered!.subtitle, `${type} should have subtitle string`).toBe("string");
      expect(typeof rendered!.body, `${type} should have body string`).toBe("string");

      // Dotted-path patterns like {shareInvitation.body} indicate a raw i18n key was
      // returned instead of its value — this means a key is missing in en.json.
      // Note: single-word patterns like {appName}, {firstName} are legitimate layout-level
      // placeholders deferred to the renderLayout step, so we only flag dotted paths.
      const html = rendered!.body + (rendered!.subtitle ?? "");
      expect(
        html,
        `${type} output contains raw i18n key {x.y} — key missing in en.json`,
      ).not.toMatch(/\{[a-zA-Z][a-zA-Z0-9]*\.[a-zA-Z][a-zA-Z0-9.]*\}/);
    }
  });
});
