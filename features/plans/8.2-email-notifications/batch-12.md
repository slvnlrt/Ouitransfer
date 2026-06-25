# Batch 12: Frontend — All Changes

> **Depends on:** Batch 11 (all server endpoints complete), Batch 8 (share visits endpoint), Batch 9 (identify endpoint), Batch 10 (preferences + unsubscribe endpoints)
> **Required by:** nothing (final batch — post-implementation validation follows)

**Goal:** Build all frontend components for notification preferences, share form extensions, visitor identification, activity tab, and admin email section.

**Files:** See index.md File Map (web section).

**Reference:** Spec Section 8 (frontend changes).

**Note:** This batch is large. It can be split into sub-batches if preferred:
- **12A:** API client functions + TypeScript types
- **12B:** Notification preferences page
- **12C:** Share creation/edit form extensions
- **12D:** Visitor identification form + Activity tab
- **12E:** RecipientSelector enhancements + Admin email section + i18n

### Steps

- [ ] **Step 1: Create API client functions**

Create `apps/web/src/api/notifications.ts`:

```typescript
import { fetchApi } from "./fetch"; // or whatever the existing pattern is

export async function getNotificationPreferences() { /* GET /notifications/preferences */ }
export async function updateNotificationPreferences(preferences: { type: string; frequency: string }[]) { /* PUT */ }
export async function getShareVisits(shareId: string, params?: { action?: string; page?: number; limit?: number }) { /* GET /shares/:shareId/visits */ }
export async function identifyVisitor(alias: string, data: { name?: string; email?: string }) { /* POST /shares/alias/:alias/identify */ }
export async function getEmailStats() { /* GET /admin/email/stats */ }
export async function sendTestEmail(to: string) { /* POST /admin/email/test */ }
```

Follow existing API client patterns in the codebase (look at `apps/web/src/api/` or equivalent).

- [ ] **Step 2: Update TypeScript types**

Update share response types to include new fields:

```typescript
interface Share {
  // ... existing fields ...
  nameFieldRequired: "HIDDEN" | "OPTIONAL" | "REQUIRED";
  emailFieldRequired: "HIDDEN" | "OPTIONAL" | "REQUIRED";
  notifyOnDownload: boolean;
  inactivityAlertDays: number | null;
  lastDownloadedAt: string | null;
  notifiedForExpiration: boolean;
}

interface ShareRecipient {
  // ... existing fields ...
  name: string | null;
  trackingToken: string | null;
  notifiedAt: string | null;
  lastAccessedAt: string | null;
  accessCount: number;
}
```

- [ ] **Step 3: Build Settings > Notifications page**

Create `apps/web/src/app/settings/notifications/page.tsx`:

- Use TanStack Query to fetch preferences (`useQuery` + `useMutation`)
- Render a table with one row per configurable type
- Each row: type label + frequency dropdown (Immediate / Disabled)
- Save button per row or bulk save
- Follow existing settings page patterns (see `apps/web/src/app/settings/` for reference)

Add navigation link to the notifications page in the settings nav/layout.

- [ ] **Step 4: Extend share creation/edit modals**

Modify `share-item-modal.tsx` and `share-multiple-items-modal.tsx`:

Add a collapsible "Privacy & Notifications" section (collapsed by default):
- **Require visitor name:** dropdown (Hidden / Optional / Required)
- **Require visitor email:** dropdown (Hidden / Optional / Required)
- **Notify me on each download:** toggle
- **Alert me if no downloads after X days:** number input (empty = disabled)

These fields are optional and do not change the basic share creation flow. Pass them in the create/update API calls.

Also update the share update/edit form with the same fields.

- [ ] **Step 5: Build visitor identification form**

Create `apps/web/src/components/share/visitor-identification-form.tsx`:

- Displayed when share access returns 403 IDENTIFICATION_REQUIRED
- Shows name/email fields based on share settings (from metadata endpoint)
- On submit: POST to `/shares/alias/:alias/identify`
- On success: reload share data (cookie is set automatically by the browser)
- Similar design to the existing reverse share identification form

Integration point: In the share page component (`/s/{alias}`), catch the IDENTIFICATION_REQUIRED error and show this form instead of the share content.

- [ ] **Step 6: Build share Activity tab**

Create `apps/web/src/components/share/share-activity-tab.tsx`:

- New tab on the share detail page (visible to creator only)
- Fetches visits from `GET /shares/:shareId/visits`
- Renders as a feed:
  - Icon: eye (access) or download (download)
  - Visitor info: name/email if identified, "Anonymous visitor" + IP if not
  - Timestamp
- Filters: action type, identified/anonymous
- Pagination

- [ ] **Step 7: Enhance RecipientSelector**

Modify `apps/web/src/components/general/recipient-selector.tsx`:

- Add optional name field per recipient
- Show "Notified" indicator: check icon when `notifiedAt` is set (use recipient data from API)
- Fix "Notify Selected" button: pass `{ emails: [selected emails] }` in the API call (bug #1 fix)
- Show recipient stats if available (access count, last accessed)

- [ ] **Step 8: Add admin email section**

In the existing admin settings email page:

- Add "Send test email" section: email input + send button
- Add queue status card: Pending / Sent (24h) / Failed counters
- Both use the admin API endpoints from Batch 11
- Auto-refresh stats every 30 seconds or on test email send

- [ ] **Step 9: Add frontend i18n keys**

Add translation keys to `apps/web/messages/en.json` and `apps/web/messages/fr.json` for all new UI components:

- Notification preferences page: column headers, type labels, frequency labels, save button
- Share form: section title, field labels, tooltips
- Activity tab: column headers, action labels, "anonymous" text, filter labels
- Identification form: title, field labels, submit button, error messages
- Admin email section: button labels, card titles, counter labels

The 21 other locale files get English content as placeholder.

- [ ] **Step 10: Run frontend type-check and tests**

```bash
pnpm --filter @ouitransfer/web type-check
pnpm --filter @ouitransfer/web test
```

- [ ] **Step 11: Commit**

```bash
git add apps/web/
git commit -m "feat(email): add frontend for notification preferences, visitor tracking, share extensions"
```
