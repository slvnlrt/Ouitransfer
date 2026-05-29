import { prisma } from "../../shared/prisma.js";
import { ValidationError } from "../../utils/app-error.js";
import { notificationCatalog } from "../email/catalog.js";

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
    if (!(pref.type in notificationCatalog)) {
      throw new ValidationError(`Unknown notification type: ${pref.type}`);
    }

    const catalogEntry = notificationCatalog[pref.type as keyof typeof notificationCatalog];

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
 */
export async function unsubscribeUser(userId: string, type: string): Promise<void> {
  await prisma.notificationPreference.upsert({
    where: { userId_type: { userId, type } },
    create: { userId, type, frequency: "disabled" },
    update: { frequency: "disabled" },
  });
}
