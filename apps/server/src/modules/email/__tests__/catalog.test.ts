import { describe, expect, it } from "vitest";
import {
  type NotificationKey,
  type NotificationTypeConfig,
  notificationCatalog,
  typeToI18nPrefix,
} from "../catalog.js";

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

/** Types 16-19: deferred triggers. */
const deferredTriggerKeys: NotificationKey[] = [
  "quota_warning",
  "quota_exceeded",
  "files_auto_deleted",
  "share_auto_deleted",
];

/** Types 20-21: admin fan-out. */
const adminKeys: NotificationKey[] = ["admin_user_registered", "admin_quota_alert"];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("notificationCatalog", () => {
  it("has exactly 22 entries", () => {
    expect(allKeys).toHaveLength(22);
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

  it("types 16-19 have configurable true", () => {
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

  it("all requiredI18nKeys arrays are empty (Batch 4 stub)", () => {
    for (const [key, entry] of getEntries(allKeys)) {
      expect(entry.requiredI18nKeys, `${key} should have empty i18n keys`).toEqual([]);
    }
  });

  it("stub render functions produce valid LayoutSlots", () => {
    const dummyT = (key: string) => key;
    for (const [key, entry] of getEntries(allKeys)) {
      const slots = entry.render({}, dummyT);
      expect(slots, `${key} render should return object`).toBeDefined();
      expect(typeof slots.subtitle, `${key} should have subtitle string`).toBe("string");
      expect(typeof slots.body, `${key} should have body string`).toBe("string");
    }
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
