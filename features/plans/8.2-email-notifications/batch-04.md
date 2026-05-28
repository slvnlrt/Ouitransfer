# Batch 4: Notification Catalog + EmailService Orchestrator

> **Depends on:** Batch 3 (i18n loader + base layout — EmailService uses both)
> **Required by:** Batch 5 (queue uses emailQueueEvents from this batch), Batch 6 (catalog wired with real renders), Batch 7 (callers import emailService)

**Goal:** Define the notification catalog (single source of truth for all 22 types) and the EmailService that type-checks `send()` calls, resolves preferences, and enqueues jobs.

**Files:**
- Create: `apps/server/src/modules/email/catalog.ts`
- Create: `apps/server/src/modules/email/service.ts` ← **new file** (the old `service.ts` still exists; rename it to `service.old.ts` temporarily to avoid conflicts — it's deleted in Batch 7)
- Create: `apps/server/src/modules/email/__tests__/catalog.test.ts`
- Create: `apps/server/src/modules/email/__tests__/service.test.ts`

**Reference:** Spec Section 1 (architecture, type-safe send, catalog), Section 6 (preference cascade).

### Steps

- [ ] **Step 1: Define Zod schemas for all 22 payload types**

In `catalog.ts`, define one Zod schema per notification type. These are the data contracts between business modules and the email system. Key examples:

```typescript
export const WelcomeDataSchema = z.object({
  firstName: z.string(),
  loginUrl: z.string(),
});

export const PasswordResetDataSchema = z.object({
  resetUrl: z.string(),
  expiresInMinutes: z.number(),
});

export const ShareInvitationDataSchema = z.object({
  senderName: z.string(),
  shareName: z.string(),
  shareLink: z.string(),
  hasPassword: z.boolean(),
  expiresAt: z.string().optional(),
});

export const ShareAccessedDataSchema = z.object({
  shareName: z.string(),
  visitorName: z.string().optional(),
  visitorEmail: z.string().optional(),
  ipAddress: z.string().optional(),
  accessedAt: z.string(),
});

// ... define all 22 schemas. Reference spec Section 10 for which fields each type needs.
// Types 16-19 (deferred) still need schemas — they define the interface 5.2 will use.
```

- [ ] **Step 2: Build the notificationCatalog object**

**Important:** In Batch 4, all `requiredI18nKeys` arrays are initially set to `[]` (empty). The real keys are filled in Batch 6 Step 8 when templates are wired up. This prevents the i18n validation from failing at boot between Batches 4-5 (when en.json only has `common` keys). The `validateAllI18nKeys()` call is also deferred to Batch 6 Step 9.

```typescript
export interface NotificationTypeConfig {
  render: (data: unknown, t: TranslationFn) => LayoutSlots;
  payloadSchema: z.ZodType;
  priority: 0 | 1;
  isCritical: boolean;
  defaultFrequency: "immediate" | "disabled";
  configurable: boolean;
  hasUnsubscribe: boolean;
  cooldownSeconds?: number;
  requiredI18nKeys: string[];
}

// STUB render functions for now (Batch 6 wires real ones).
// Each stub returns a minimal valid LayoutSlots.
const stubRender = (_data: unknown, _t: TranslationFn): LayoutSlots => ({
  subtitle: "Email",
  body: "<p>Placeholder</p>",
});

export const notificationCatalog = {
  welcome:              { render: stubRender, payloadSchema: WelcomeDataSchema,            priority: 1, isCritical: true,  defaultFrequency: "immediate", configurable: false, hasUnsubscribe: false, requiredI18nKeys: ["welcome.subject", "welcome.subtitle", "welcome.body", "welcome.cta"] },
  password_reset:       { render: stubRender, payloadSchema: PasswordResetDataSchema,      priority: 1, isCritical: true,  defaultFrequency: "immediate", configurable: false, hasUnsubscribe: false, requiredI18nKeys: ["passwordReset.subject", "passwordReset.subtitle", "passwordReset.body", "passwordReset.cta"] },
  account_deactivated:  { render: stubRender, payloadSchema: AccountDeactivatedDataSchema, priority: 1, isCritical: true,  defaultFrequency: "immediate", configurable: false, hasUnsubscribe: false, requiredI18nKeys: ["accountDeactivated.subject", "accountDeactivated.subtitle", "accountDeactivated.body"] },
  account_reactivated:  { render: stubRender, payloadSchema: AccountReactivatedDataSchema, priority: 1, isCritical: true,  defaultFrequency: "immediate", configurable: false, hasUnsubscribe: false, requiredI18nKeys: ["accountReactivated.subject", "accountReactivated.subtitle", "accountReactivated.body", "accountReactivated.cta"] },
  share_invitation:     { render: stubRender, payloadSchema: ShareInvitationDataSchema,    priority: 0, isCritical: false, defaultFrequency: "immediate", configurable: false, hasUnsubscribe: false, requiredI18nKeys: ["shareInvitation.subject", "shareInvitation.subtitle", "shareInvitation.body", "shareInvitation.cta", "shareInvitation.info", "shareInvitation.infoPassword"] },
  // ... all 22 entries. Reference spec Section 10 for the full table.
  // share_accessed and share_downloaded default to "disabled" (noisy on popular shares).
  // share_accessed and share_downloaded also have cooldownSeconds: 900 (15-minute dedup window).
  // Types 5-6 (invitations): configurable: false, hasUnsubscribe: false.
  // Types 7-15: configurable: true, hasUnsubscribe: true.
  // Types 16-19: configurable: true, hasUnsubscribe: true (deferred triggers).
  // Types 20-21: configurable: true, hasUnsubscribe: true (admin fan-out).
  // Type 22 (test_email): priority: 1, isCritical: true, configurable: false.
} as const satisfies Record<string, NotificationTypeConfig>;
```

- [ ] **Step 3: Derive the EmailPayloads type**

```typescript
export type NotificationKey = keyof typeof notificationCatalog;

export type EmailPayloads = {
  [K in NotificationKey]: z.infer<(typeof notificationCatalog)[K]["payloadSchema"]>;
};
```

This ensures `emailService.send("share_invitation", { data: ... })` type-checks the `data` field against `ShareInvitationDataSchema`. Adding a new type to the catalog auto-extends the type map.

- [ ] **Step 4: Write catalog tests**

```typescript
describe("notificationCatalog", () => {
  it("has exactly 22 entries");
  it("all entries have required fields (render, payloadSchema, priority, ...)");
  it("critical types (welcome, password_reset, account_deactivated, account_reactivated, test_email) have priority 1 and isCritical true");
  it("types 7-8 (share_accessed, share_downloaded) default to 'disabled'");
  it("types 16-19 have configurable true");
  it("all requiredI18nKeys arrays are non-empty");
  it("critical types all have hasUnsubscribe: false (invariant)");
  it("critical types all have configurable: false (invariant)");
});
```

- [ ] **Step 5: Implement EmailService**

The `send()` method orchestrates: SMTP check → preference cascade → render → enqueue.

```typescript
// service.ts (NEW — not the old monolithic class)
import { prisma } from "../../shared/prisma.js";
import { getLogger } from "../../utils/logger.js";
import { getConfigValue } from "../config/service.js";
import { notificationCatalog, type NotificationKey, type EmailPayloads } from "./catalog.js";
import { createTranslationFn } from "./i18n/loader.js";
import { renderLayout } from "./templates/base-layout.js";
import { EventEmitter } from "node:events";
import * as crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../../env.js";

// NOTE: emailQueueEvents lives in email/events.ts (not here) to avoid circular imports
// between service and queue. Both service.ts and queue.ts import from events.ts.
// export const emailQueueEvents = new EventEmitter(); // ← defined in events.ts

class EmailService {
  async send<T extends NotificationKey>(
    type: T,
    options: {
      to: string;
      locale: string;
      userId?: string;
      data: EmailPayloads[T];
      shareId?: string; // for per-share overrides
    },
  ): Promise<void> {
    // 1. Check SMTP enabled
    const smtpEnabled = await getConfigValue("smtpEnabled").catch(() => "false");
    if (smtpEnabled !== "true") return;

    // 1b. Check appUrl is configured (required for links in emails)
    let appUrl: string;
    try {
      appUrl = await getAppUrl();
    } catch {
      getLogger().warn("appUrl not configured — email not sent");
      return;
    }

    const entry = notificationCatalog[type];

    // 2. For critical types: skip preference checks
    // 3. For non-critical: resolve user preference via cascade (spec Section 6)
    //    - Check NotificationPreference for (userId, type)
    //    - If "disabled" → return
    //    - If per-share override (notifyOnDownload) → upgrade to immediate
    // 4. Render template
    //    - On render failure: create FAILED job immediately, no retry. Log error.
    // 5. Add unsubscribe URL if applicable (entry.hasUnsubscribe && userId)
    //    - JWT: { userId, type, iat, exp } signed with HMAC-derived key
    // 6. Call renderLayout(slots, { appName })
    // 7. Insert EmailJob row (status: "pending", htmlBody/textBody pre-rendered)
    // 8. For priority 1: emit "wake" on emailQueueEvents
  }

  async resolveFrequency(
    type: string,
    userId: string,
    shareId?: string,
  ): Promise<"immediate" | "daily_digest" | "disabled"> {
    // Step 1: Check user preference
    const pref = await prisma.notificationPreference.findUnique({
      where: { userId_type: { userId, type } },
    });
    const userFrequency = pref?.frequency ?? notificationCatalog[type as NotificationKey]?.defaultFrequency ?? "immediate";

    // Step 2: If disabled, ALWAYS return disabled (global disabled wins)
    if (userFrequency === "disabled") return "disabled";

    // Step 3: Check per-share override
    if (shareId && type === "share_downloaded") {
      const share = await prisma.share.findUnique({ where: { id: shareId }, select: { notifyOnDownload: true } });
      if (share?.notifyOnDownload) return "immediate";
    }

    return userFrequency as "immediate" | "daily_digest" | "disabled";
  }

  async generateUnsubscribeUrl(userId: string, type: string): Promise<string> {
    const secret = crypto.createHmac("sha256", env.JWT_SECRET).update("unsubscribe").digest();
    const token = jwt.sign({ userId, type }, secret, { expiresIn: "90d" });
    return buildUnsubscribeUrl(token); // uses url-builder.ts
  }
}

export const emailService = new EmailService();
```

- [ ] **Step 6: Write EmailService tests**

```typescript
describe("EmailService", () => {
  // Mock prisma, getConfigValue, renderLayout
  it("send('password_reset', ...) creates EmailJob with priority 1, status 'pending', pre-rendered HTML");
  it("send() when SMTP disabled → no job created");
  it("send('share_accessed', ...) checks user preference; if 'disabled' → no job");
  it("send() for critical types ignores user preferences");
  it("send() with share override: notifyOnDownload=true upgrades to immediate");
  it("send() calls template render function with correct data and translation fn");
  it("send() calls renderLayout with LayoutSlots from template");
  it("send() adds unsubscribe URL for types with hasUnsubscribe=true + userId");
  it("send() emits 'wake' event for priority 1 jobs");
  it("send() on render failure creates FAILED job with render error message");
  it("resolveFrequency() returns catalog default when no preference exists");
  it("resolveFrequency() returns 'disabled' when user preference is disabled");
  it("resolveFrequency() returns 'immediate' when notifyOnDownload=true (share override)");
  it("resolveFrequency() disabled wins over notifyOnDownload=true");
  it("generateUnsubscribeUrl() returns valid JWT URL with exp=90d");
});
```

- [ ] **Step 7: Run tests**

```bash
pnpm --filter @ouitransfer/server test -- --run src/modules/email/__tests__/service.test.ts src/modules/email/__tests__/catalog.test.ts
```

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/modules/email/catalog.ts apps/server/src/modules/email/service.ts apps/server/src/modules/email/__tests__/catalog.test.ts apps/server/src/modules/email/__tests__/service.test.ts
git commit -m "feat(email): add notification catalog and EmailService orchestrator with type-safe send"
```

**Coexistence strategy (Batches 4-7):** The old monolithic `EmailService` class (in `email/service.ts`) is still referenced by 4 callers. The new `emailService` singleton lives in a DIFFERENT file during Batches 4-6:

- **Batch 4 creates:** `email/email-service.ts` (the new EmailService singleton — temporary name)
- **Batch 5-6:** Import from `email/email-service.ts`. The old `email/service.ts` is untouched. Server still compiles because all old callers reference the old class.
- **Batch 7:** Migrates all 4 callers to import from `email/email-service.ts`, deletes the old `email/service.ts`, renames `email-service.ts` → `service.ts`, updates all imports.

This avoids any intermediate state where the server doesn't compile. The rename is a single atomic step in Batch 7.

**Notification cooldown for noisy types:** Types with `defaultFrequency: "disabled"` (share_accessed, share_downloaded) can generate hundreds of notifications per hour on popular shares. The `send()` method implements a per-(userId, type, shareId) cooldown:

- Before enqueuing, check: is there an `EmailJob` with the same `type` + `to` + `relatedId` (shareId) created within the last 15 minutes?
- If yes: skip (dedup). The ShareVisit is still recorded (tracking is separate from notifications).
- The cooldown only applies to types where `catalog[type].defaultFrequency === "disabled"` (the noisy ones). Other types fire unconditionally.
- The 15-minute window is hardcoded (not configurable) — it prevents floods while still being responsive enough for legitimate monitoring.
- Set `cooldownSeconds: 900` on `share_accessed` and `share_downloaded` catalog entries.

**Admin fan-out (types 20-21):** For notification types like `admin_user_registered` and `admin_quota_alert`, the caller does NOT call `send()` for each admin. Instead, a helper method handles the fan-out:

```typescript
async sendToAdmins<T extends NotificationKey>(
  type: T,
  data: EmailPayloads[T],
): Promise<void> {
  const admins = await prisma.user.findMany({
    where: { isAdmin: true, isActive: true },
    select: { id: true, email: true },
  });
  for (const admin of admins) {
    if (!admin.email) continue;
    await this.send(type, {
      to: admin.email,
      locale: "en",
      userId: admin.id,
      data,
    });
  }
}
```

Each admin gets their own `EmailJob` (their preference is checked individually). The business module calls `emailService.sendToAdmins("admin_user_registered", { ... })`.

**Subject from i18n:** The `send()` method resolves the email subject via i18n:

```typescript
const subject = t(`${this.typeToI18nPrefix(type)}.subject`, { appName, ...stringifyParams(options.data) });
```

Each template's `requiredI18nKeys` includes the `.subject` key. The subject is stored pre-rendered on the `EmailJob` row.

**URL builder:** Create `apps/server/src/modules/email/url-builder.ts` to centralize all URL construction:

```typescript
// url-builder.ts
import { getConfigValue } from "../config/service.js";
import { getLogger } from "../../utils/logger.js";

let cachedAppUrl: string | null = null;

export async function getAppUrl(): Promise<string> {
  if (cachedAppUrl) return cachedAppUrl;
  try {
    const url = await getConfigValue("appUrl");
    if (!url) throw new Error("appUrl is empty");
    cachedAppUrl = url;
    return url;
  } catch {
    throw new Error("appUrl not configured — cannot generate email links");
  }
}

export async function buildShareLink(alias: string, trackingToken?: string): Promise<string> {
  const base = await getAppUrl();
  const url = `${base}/s/${alias}`;
  return trackingToken ? `${url}?t=${trackingToken}` : url;
}

export async function buildShareManageUrl(shareId: string): Promise<string> {
  const base = await getAppUrl();
  return `${base}/shares/${shareId}`;
}

export async function buildResetPasswordUrl(token: string): Promise<string> {
  const base = await getAppUrl();
  return `${base}/auth/reset-password/${token}`;
}

export async function buildUnsubscribeUrl(token: string): Promise<string> {
  const base = await getAppUrl();
  return `${base}/api/notifications/unsubscribe?token=${token}`;
}

// Called on config change to bust cache
export function invalidateAppUrlCache(): void {
  cachedAppUrl = null;
}
```

All callers and templates use this helper instead of building URLs manually. If `appUrl` is not configured, `send()` catches the error and marks the job as `failed` with `"appUrl not configured"`.
