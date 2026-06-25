# 8.2 Email Notifications — Implementation Plan Index

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inline email system with a modular, queue-based, i18n-ready notification architecture with visitor tracking and user preferences.

**Architecture:** 5-layer email module (service → templates → i18n → queue → transport) backed by SQLite `EmailJob` queue. 22 notification types defined in a single `notificationCatalog` object (source of truth for type safety, rendering, i18n validation, and preferences). Visitor tracking via `ShareVisit` table with three identification mechanisms (tracking token, identification form, IP/UA).

**Tech Stack:** Fastify 5, Prisma (SQLite), Nodemailer (pool), Zod, Next.js 15, TanStack Query, next-intl

**Spec:** [`features/specs/8.2-email-notifications.md`](../specs/8.2-email-notifications.md) — the canonical reference for all requirements (~1000 lines). Read it before starting any batch.

---

## Execution Order

```
Batch 1:  Prisma Schema + Config Seed
  ↓
Batch 2:  SmtpTransport
  ↓
Batch 3:  i18n Loader + Base Layout
  ↓
Batch 4:  Notification Catalog + EmailService Orchestrator
  ↓
Batch 5:  Email Queue Scheduler
  ↓
Batch 6:  Template Functions (all 22)
  ↓
Batch 7:  Migration + Bug Fixes + Recipient Upsert
  ↓
Batch 8:  Visitor Tracking + Download Tracking
  ↓
Batch 9:  Identification + Inactivity/Expiration Schedulers
  ↓
Batch 10: Notification Preferences + Unsubscribe
  ↓
Batch 11: Admin Email Endpoints
  ↓
Batch 12: Frontend (all changes)
```

**Natural phase boundaries** (good stopping points for review):
- After Batch 5: email foundation is complete, can send programmatic emails
- After Batch 7: all existing callers migrated, old system deleted
- After Batch 11: all server-side features complete
- After Batch 12: full stack complete

---

## File Map

### New files — Server

```
apps/server/src/modules/email/
  transport.ts                → SmtpTransport (SMTP pool, config hash, raw send)
  queue.ts                    → EmailQueueScheduler (poll, process, retry, cleanup, wake-up)
  notification.scheduler.ts   → Inactivity alerts + expiration notifications (daily)
  url-builder.ts              → Centralized URL construction (appUrl + share/reset/manage URLs)
  events.ts                 → emailQueueEvents EventEmitter (shared between service and queue)
  catalog.ts                  → notificationCatalog + type derivation + EmailPayloads type
  dto.ts                      → Zod schemas for email-related endpoints
  templates/
    base-layout.ts            → renderLayout() → { html, text }
    welcome.ts
    password-reset.ts
    account-deactivated.ts
    account-reactivated.ts
    share-invitation.ts
    share-accessed.ts
    share-downloaded.ts
    share-expiring.ts
    share-expired.ts
    share-max-views-reached.ts
    share-no-activity.ts
    reverse-share-invitation.ts
    reverse-share-uploaded.ts
    reverse-share-expiring.ts
    reverse-share-expired.ts
    quota-warning.ts           → minimal (TODO for 5.2)
    quota-exceeded.ts          → minimal (TODO for 5.2)
    files-auto-deleted.ts      → minimal (TODO for 5.2)
    share-auto-deleted.ts      → minimal (TODO for 5.2)
    admin-user-registered.ts
    admin-quota-alert.ts
    test-email.ts
  i18n/
    loader.ts                 → t() function, JSON loading, fallback chain
    messages/
      en.json                 → Complete English translations
      fr.json                 → Complete French translations
  __tests__/
    transport.test.ts
    i18n-loader.test.ts
    base-layout.test.ts
    catalog.test.ts
    service.test.ts
    queue.test.ts
    notification-scheduler.test.ts
    templates.test.ts         → All template tests (grouped)

apps/server/src/modules/notification/
  routes.ts                   → Preferences CRUD + unsubscribe
  service.ts                  → Preference resolution, unsubscribe JWT
  __tests__/
    routes.test.ts
    service.test.ts
```

### New files — Web

```
apps/web/src/app/settings/notifications/
  page.tsx
  hooks/use-notification-preferences.ts
  components/
    notification-preferences-table.tsx
    notification-row.tsx

apps/web/src/components/share/
  visitor-identification-form.tsx
  share-activity-tab.tsx

apps/web/src/api/notifications.ts
```

### Modified files — Server

```
apps/server/prisma/schema.prisma          → New models + modified models
apps/server/prisma/seed.js                → New config keys
apps/server/src/server.ts                 → Register routes + schedulers + onClose hooks
apps/server/src/modules/email/service.ts  → REWRITE (old class → new EmailService)
apps/server/src/modules/auth/service.ts   → Migrate password reset
apps/server/src/modules/ldap/sync.service.ts   → Migrate LDAP welcome
apps/server/src/modules/share/service.ts  → Migrate share notify, recipient upsert, visitor tracking
apps/server/src/modules/share/routes.ts   → Identification gate, tracking token, notify fix, identify endpoint
apps/server/src/modules/share/dto.ts      → New fields in share schemas
apps/server/src/modules/share/repository.ts → Recipient upsert methods
apps/server/src/modules/reverse-share/upload.service.ts → Migrate reverse share notification
apps/server/src/modules/file/routes.ts    → Add shareId to download endpoints
```

### Modified files — Web

```
apps/web/src/components/modals/share-item-modal.tsx
apps/web/src/components/modals/share-multiple-items-modal.tsx
apps/web/src/components/general/recipient-selector.tsx
apps/web/src/app/settings/layout.tsx (or equivalent nav)
```

---

## Batch Table of Contents

| Batch | File | Title | Summary |
|-------|------|-------|---------|
| 1 | [batch-01.md](batch-01.md) | Prisma Schema + Config Seed | Add EmailJob, NotificationPreference, ShareVisit models; extend Share/ShareRecipient/User; seed config keys |
| 2 | [batch-02.md](batch-02.md) | SmtpTransport | Replace duplicated `createTransporter()` with a pooled, config-hash-aware SMTP transport class |
| 3 | [batch-03.md](batch-03.md) | i18n Loader + Base Layout | Server-side i18n with fallback chain; HTML/text base layout for all email templates |
| 4 | [batch-04.md](batch-04.md) | Notification Catalog + EmailService Orchestrator | Define all 22 notification types; EmailService with type-safe `send()`, preference cascade, and queue enqueue |
| 5 | [batch-05.md](batch-05.md) | Email Queue Scheduler | Queue scheduler polling EmailJob, SMTP send, retry with exponential backoff, cleanup, wake-up signal |
| 6 | [batch-06.md](batch-06.md) | Template Functions (all 22) | All 22 notification template render functions; complete en/fr i18n keys; wire into catalog |
| 7 | [batch-07.md](batch-07.md) | Migration + Bug Fixes + Recipient Upsert | Migrate 4 existing callers; delete old EmailService; fix 5 MVP bugs; upsert recipient tracking tokens |
| 8 | [batch-08.md](batch-08.md) | Visitor Tracking + Download Tracking | Record ShareVisit on share access and file downloads; update lastDownloadedAt; visits endpoint |
| 9 | [batch-09.md](batch-09.md) | Identification Form + Inactivity/Expiration Schedulers | Visitor identification cookie endpoint; IDENTIFICATION_REQUIRED gate; daily notification schedulers |
| 10 | [batch-10.md](batch-10.md) | Notification Preferences + Unsubscribe | User notification preferences CRUD; preference cascade integration; two-step unsubscribe flow |
| 11 | [batch-11.md](batch-11.md) | Admin Email Endpoints | Admin email queue stats and test email send endpoints |
| 12 | [batch-12.md](batch-12.md) | Frontend (all changes) | All web components: preferences page, share form extensions, visitor identification, activity tab, admin email section |

---

## Post-Implementation

- [ ] **Run full validation**

```bash
just validate
```

This runs lint + type-check + tests across all packages. Everything must pass.

- [ ] **Run E2E tests if available**

```bash
pnpm e2e
```

- [ ] **Update features/README.md**

Set 8.2 status to "Done" in the status table.

- [ ] **Update features/SESSIONS.md**

Add session log entry with date + summary of what was done.

- [ ] **Commit documentation**

```bash
git add features/README.md features/SESSIONS.md
git commit -m "docs: mark 8.2 Email Notifications as done"
```

---

> **Original plan**: The complete plan is preserved in `../8.2-email-notifications.md` for reference.
