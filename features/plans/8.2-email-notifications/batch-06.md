# Batch 6: Template Functions (all 22)

> **Depends on:** Batch 3 (base layout + i18n loader — templates use both), Batch 4 (catalog.ts — templates wire into it), Batch 5 (queue scheduler — i18n validation called from initEmailQueueOnBoot)
> **Required by:** Batch 7 (migration uses render functions to verify all templates work end-to-end)

**Goal:** Implement all 22 template functions, complete en/fr i18n keys, wire real render functions into the catalog.

**Files:**
- Create: 22 files in `apps/server/src/modules/email/templates/`
- Modify: `apps/server/src/modules/email/i18n/messages/en.json` — add all template keys
- Modify: `apps/server/src/modules/email/i18n/messages/fr.json` — add all template keys
- Modify: `apps/server/src/modules/email/catalog.ts` — replace stub renders with real imports
- Create: `apps/server/src/modules/email/__tests__/templates.test.ts`

**Reference:** Spec Section 3 (template pattern), Section 10 (full catalog — data types per notification).

**i18n key convention:** Catalog type keys use snake_case (`share_invitation`). i18n key prefixes use camelCase equivalents (`shareInvitation`). A helper function maps between them:

```typescript
function typeToI18nPrefix(type: NotificationKey): string {
  return type.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}
// "share_invitation" → "shareInvitation"
```

### Template Pattern

Every template follows this structure (shown for `share-invitation.ts`):

```typescript
// templates/share-invitation.ts
import type { LayoutSlots } from "./base-layout.js";
import type { TranslationFn } from "../i18n/loader.js";

export interface ShareInvitationData {
  senderName: string;
  shareName: string;
  shareLink: string;
  hasPassword: boolean;
  expiresAt?: string;
}

export function renderShareInvitation(data: ShareInvitationData, t: TranslationFn): LayoutSlots {
  return {
    subtitle: t("shareInvitation.subtitle"),
    body: t("shareInvitation.body", {
      senderName: data.senderName,
      shareName: data.shareName,
    }),
    cta: { url: data.shareLink, label: t("shareInvitation.cta") },
    infoBox: data.hasPassword
      ? t("shareInvitation.infoPassword")
      : t("shareInvitation.info"),
  };
}
```

### Steps

- [ ] **Step 1: Implement account lifecycle templates (4)**

| File | Function | Data interface |
|------|----------|---------------|
| `welcome.ts` | `renderWelcome` | `{ firstName, loginUrl }` |
| `password-reset.ts` | `renderPasswordReset` | `{ resetUrl, expiresInMinutes }` |
| `account-deactivated.ts` | `renderAccountDeactivated` | `{ firstName, adminContactEmail? }` |
| `account-reactivated.ts` | `renderAccountReactivated` | `{ firstName, loginUrl }` |

All follow the template pattern above. `password-reset` uses infoBox for the expiration warning. `account-deactivated` uses infoBox for "contact admin" message.

- [ ] **Step 2: Implement share templates (7)**

| File | Function | Data interface |
|------|----------|---------------|
| `share-invitation.ts` | `renderShareInvitation` | `{ senderName, shareName, shareLink, hasPassword, expiresAt? }` |
| `share-accessed.ts` | `renderShareAccessed` | `{ shareName, visitorName?, visitorEmail?, ipAddress?, accessedAt }` |
| `share-downloaded.ts` | `renderShareDownloaded` | `{ shareName, fileName, visitorName?, visitorEmail?, downloadedAt }` |
| `share-expiring.ts` | `renderShareExpiring` | `{ shareName, expiresAt, daysRemaining, shareManageUrl }` |
| `share-expired.ts` | `renderShareExpired` | `{ shareName, expiredAt }` |
| `share-max-views-reached.ts` | `renderShareMaxViewsReached` | `{ shareName, maxViews, shareManageUrl }` |
| `share-no-activity.ts` | `renderShareNoActivity` | `{ shareName, daysSinceLastDownload, shareManageUrl }` |

`share-accessed` and `share-downloaded` show visitor identity if available, otherwise "anonymous visitor." Use conditional i18n keys: `shareAccessed.bodyIdentified` vs `shareAccessed.bodyAnonymous`.

- [ ] **Step 3: Implement reverse share templates (4)**

| File | Function | Data interface |
|------|----------|---------------|
| `reverse-share-invitation.ts` | `renderReverseShareInvitation` | `{ senderName, reverseShareName, reverseShareLink, hasPassword }` |
| `reverse-share-uploaded.ts` | `renderReverseShareUploaded` | `{ reverseShareName, fileCount, fileList, uploaderName?, uploaderEmail? }` |
| `reverse-share-expiring.ts` | `renderReverseShareExpiring` | `{ reverseShareName, expiresAt, daysRemaining }` |
| `reverse-share-expired.ts` | `renderReverseShareExpired` | `{ reverseShareName, expiredAt }` |

`reverse-share-uploaded` replaces the existing `sendReverseShareBatchFileNotification`. Match its current data shape to avoid breaking the migration in Batch 7.

- [ ] **Step 4: Implement admin templates (2) + test email (1)**

| File | Function | Data interface |
|------|----------|---------------|
| `admin-user-registered.ts` | `renderAdminUserRegistered` | `{ newUserName, newUserEmail, registrationMethod }` |
| `admin-quota-alert.ts` | `renderAdminQuotaAlert` | `{ userName, userEmail, usagePercent, usedStorage, maxStorage }` |
| `test-email.ts` | `renderTestEmail` | `{ recipientEmail }` |

`test-email` is a simple "Your SMTP configuration is working correctly" confirmation.

- [ ] **Step 5: Implement deferred templates (4, minimal with TODO)**

| File | Function | Notes |
|------|----------|-------|
| `quota-warning.ts` | `renderQuotaWarning` | Generic content, `// TODO: finalize when 5.2 triggers are implemented` |
| `quota-exceeded.ts` | `renderQuotaExceeded` | Same |
| `files-auto-deleted.ts` | `renderFilesAutoDeleted` | Same |
| `share-auto-deleted.ts` | `renderShareAutoDeleted` | Same |

These are functional (render valid HTML) but have generic/placeholder wording. Their data interfaces define the contract 5.2 will use.

- [ ] **Step 6: Complete en.json**

Add all i18n keys for all 22 types. Each type needs at minimum `subject`, `subtitle`, `body`. Some also need `cta`, `info`, `infoPassword`, `bodyIdentified`, `bodyAnonymous`.

Example structure for the complete file:

```json
{
  "common": { "footer": "...", "footerIgnore": "...", "poweredBy": "...", "unsubscribe": "..." },
  "welcome": { "subject": "{appName} - Welcome!", "subtitle": "Welcome", "body": "...", "cta": "..." },
  "passwordReset": { "subject": "{appName} - Password Reset", "subtitle": "Password Reset", "body": "...", "cta": "...", "info": "..." },
  "accountDeactivated": { "subject": "...", "subtitle": "...", "body": "...", "info": "..." },
  "accountReactivated": { "subject": "...", "subtitle": "...", "body": "...", "cta": "..." },
  "shareInvitation": { "subject": "{appName} - {shareName} shared with you", "subtitle": "Shared Files", "body": "...", "cta": "...", "info": "...", "infoPassword": "..." },
  "shareAccessed": { "subject": "...", "subtitle": "...", "bodyIdentified": "...", "bodyAnonymous": "..." },
  "shareDownloaded": { "subject": "...", "subtitle": "...", "bodyIdentified": "...", "bodyAnonymous": "..." },
  "shareExpiring": { "subject": "...", "subtitle": "...", "body": "...", "cta": "..." },
  "shareExpired": { "subject": "...", "subtitle": "...", "body": "..." },
  "shareMaxViewsReached": { "subject": "...", "subtitle": "...", "body": "...", "cta": "..." },
  "shareNoActivity": { "subject": "...", "subtitle": "...", "body": "...", "cta": "..." },
  "reverseShareInvitation": { "subject": "...", "subtitle": "...", "body": "...", "cta": "...", "info": "...", "infoPassword": "..." },
  "reverseShareUploaded": { "subject": "...", "subtitle": "...", "body": "..." },
  "reverseShareExpiring": { "subject": "...", "subtitle": "...", "body": "...", "cta": "..." },
  "reverseShareExpired": { "subject": "...", "subtitle": "...", "body": "..." },
  "quotaWarning": { "subject": "...", "subtitle": "...", "body": "..." },
  "quotaExceeded": { "subject": "...", "subtitle": "...", "body": "..." },
  "filesAutoDeleted": { "subject": "...", "subtitle": "...", "body": "..." },
  "shareAutoDeleted": { "subject": "...", "subtitle": "...", "body": "..." },
  "adminUserRegistered": { "subject": "...", "subtitle": "...", "body": "..." },
  "adminQuotaAlert": { "subject": "...", "subtitle": "...", "body": "..." },
  "testEmail": { "subject": "{appName} - Test Email", "subtitle": "Test", "body": "..." }
}
```

Write proper, natural-sounding English text for all keys. The subject line should include `{appName}` prefix.

- [ ] **Step 7: Complete fr.json**

Same structure with proper French translations for all 22 types.

- [ ] **Step 8: Wire real render functions into catalog.ts**

Replace all `stubRender` with actual imports:

```typescript
import { renderWelcome } from "./templates/welcome.js";
import { renderPasswordReset } from "./templates/password-reset.js";
import { renderAccountDeactivated } from "./templates/account-deactivated.js";
// ... all 22 imports

export const notificationCatalog = {
  welcome: { render: renderWelcome, /* ... */ },
  password_reset: { render: renderPasswordReset, /* ... */ },
  // ... all 22 entries with real render functions
};
```

- [ ] **Step 9: Add i18n validation on boot**

In `catalog.ts` export a function that validates all i18n keys:

```typescript
export function validateAllI18nKeys(): void {
  const allKeys = Object.values(notificationCatalog).flatMap(c => c.requiredI18nKeys);
  validateI18nKeys([...new Set(allKeys)]);
}
```

Call this from `initEmailQueueOnBoot()` (in queue.ts) or from the service initialization.

- [ ] **Step 10: Write template tests**

Group tests by category. Each test verifies the render function returns valid LayoutSlots with expected content:

```typescript
describe("template functions", () => {
  // Use a mock TranslationFn that returns the key path (easy assertion)
  const mockT: TranslationFn = (path, params) => `[${path}:${JSON.stringify(params)}]`;

  describe("renderWelcome", () => {
    it("returns subtitle from i18n, body with firstName, cta with loginUrl");
  });

  describe("renderShareInvitation", () => {
    it("returns cta with shareLink, info when no password, infoPassword when has password");
  });

  describe("renderShareAccessed", () => {
    it("uses bodyIdentified when visitorName is provided");
    it("uses bodyAnonymous when no visitor identity");
  });

  // ... one describe per template
});
```

- [ ] **Step 11: Run all tests**

```bash
pnpm --filter @ouitransfer/server test
```

All existing tests + new template tests + catalog tests must pass.

- [ ] **Step 12: Commit**

```bash
git add apps/server/src/modules/email/templates/ apps/server/src/modules/email/i18n/ apps/server/src/modules/email/catalog.ts apps/server/src/modules/email/__tests__/
git commit -m "feat(email): implement all 22 notification templates with en/fr i18n"
```
