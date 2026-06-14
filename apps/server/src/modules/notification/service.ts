import { prisma } from "../../shared/prisma.js";
import { ValidationError } from "../../utils/app-error.js";
import { isNotificationKey, notificationCatalog } from "../email/catalog.js";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Allowed user-facing frequency values. daily_digest not yet implemented. */
const ALLOWED_FREQUENCIES = ["immediate", "disabled"] as const;
type AllowedFrequency = (typeof ALLOWED_FREQUENCIES)[number];

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NotificationPreferenceItem {
  type: string;
  frequency: string;
  configurable: boolean;
  isCritical: boolean;
  defaultFrequency: string;
}

export interface UpdatePreferenceInput {
  type: string;
  frequency: string;
}

// ─── Service functions ────────────────────────────────────────────────────────

/**
 * Returns the full preference list for a user, merging stored rows with
 * catalog defaults. Includes ALL types (configurable and non-configurable)
 * for display purposes.
 */
export async function getUserPreferences(userId: string): Promise<NotificationPreferenceItem[]> {
  const storedPrefs = await prisma.notificationPreference.findMany({
    where: { userId },
  });

  // Index stored prefs by type for fast lookup
  const storedByType = new Map<string, string>();
  for (const pref of storedPrefs) {
    storedByType.set(pref.type, pref.frequency);
  }

  const result: NotificationPreferenceItem[] = [];

  for (const [type, config] of Object.entries(notificationCatalog)) {
    const storedFrequency = storedByType.get(type);
    result.push({
      type,
      frequency: storedFrequency ?? config.defaultFrequency,
      configurable: config.configurable,
      isCritical: config.isCritical,
      defaultFrequency: config.defaultFrequency,
    });
  }

  return result;
}

/**
 * Updates the user's notification preferences.
 * Only configurable types may be updated.
 * Only "immediate" and "disabled" frequencies are accepted (no daily_digest yet).
 */
export async function updateUserPreferences(
  userId: string,
  preferences: UpdatePreferenceInput[],
): Promise<void> {
  for (const pref of preferences) {
    // Validate type exists in catalog
    if (!isNotificationKey(pref.type)) {
      throw new ValidationError(`Unknown notification type: ${pref.type}`);
    }

    const catalogEntry = notificationCatalog[pref.type];

    // Validate type is configurable
    if (!catalogEntry.configurable) {
      throw new ValidationError(`Notification type "${pref.type}" is not user-configurable`);
    }

    // Validate frequency value
    if (!ALLOWED_FREQUENCIES.includes(pref.frequency as AllowedFrequency)) {
      throw new ValidationError(
        `Invalid frequency "${pref.frequency}". Allowed values: ${ALLOWED_FREQUENCIES.join(", ")}`,
      );
    }
  }

  // All validations passed — upsert all preferences
  for (const pref of preferences) {
    await prisma.notificationPreference.upsert({
      where: { userId_type: { userId, type: pref.type } },
      create: { userId, type: pref.type, frequency: pref.frequency },
      update: { frequency: pref.frequency },
    });
  }
}

// Re-export verifyUnsubscribeToken from the shared module for backward compatibility
export { verifyUnsubscribeToken } from "../email/unsubscribe-token.js";

/**
 * Sets a user's notification preference to "disabled" for the given type.
 * Idempotent — safe to call multiple times.
 *
 * Defense-in-depth: silently ignores types that are not in the catalog,
 * are not configurable, or are critical (isCritical). This prevents
 * unsubscribe tokens from disabling critical system notifications
 * (e.g. password_reset, welcome) even if a token is crafted or reused.
 *
 * A6-05: when `tokenVersion` is provided it is compared against the user's live
 * value; a stale token (the version was bumped, e.g. on logout-all / password
 * reset) is a silent no-op so a leaked link can be revoked.
 */
export async function unsubscribeUser(
  userId: string,
  type: string,
  tokenVersion?: number,
): Promise<void> {
  // Validate the type exists in the catalog
  if (!isNotificationKey(type)) {
    return; // Silent no-op — don't leak catalog info
  }

  // A6-05: reject tokens minted under an older tokenVersion (revoked).
  if (tokenVersion !== undefined) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { tokenVersion: true },
    });
    if (!user || user.tokenVersion !== tokenVersion) {
      return; // Silent no-op — token has been revoked or user no longer exists
    }
  }

  const entry = notificationCatalog[type];

  // Critical types cannot be unsubscribed (e.g. password_reset, welcome)
  if (entry.isCritical) {
    return; // Silent no-op
  }

  // Non-configurable types cannot be unsubscribed by the user
  if (!entry.configurable) {
    return; // Silent no-op
  }

  await prisma.notificationPreference.upsert({
    where: { userId_type: { userId, type } },
    create: { userId, type, frequency: "disabled" },
    update: { frequency: "disabled" },
  });
}
