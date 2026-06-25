# Batch 1: Prisma Schema + Config Seed

> **Depends on:** nothing (first batch)
> **Required by:** Batch 2 (SmtpTransport uses Prisma config values), all subsequent batches

**Goal:** Add all new database models and modify existing ones. Add config seed entries.

**Files:**
- Modify: `apps/server/prisma/schema.prisma`
- Modify: `apps/server/prisma/seed.js`

### Steps

- [ ] **Step 1: Add EmailJob model**

Add after `AppConfig` model (~line 154). See spec Section 2 for the full model definition. Key fields:

```prisma
model EmailJob {
  id            String    @id @default(cuid())
  type          String
  to            String
  subject       String
  htmlBody      String?
  textBody      String?
  locale        String    @default("en")
  status        String    @default("pending")
  priority      Int       @default(0)
  attempts      Int       @default(0)
  maxAttempts   Int       @default(3)
  nextAttemptAt DateTime  @default(now())
  lastError     String?
  lockedAt      DateTime?
  sentAt        DateTime?
  payload       String?
  relatedId     String?
  listUnsubscribe String?
  createdAt     DateTime  @default(now())

  @@index([status, nextAttemptAt])
}
```

- [ ] **Step 2: Add NotificationPreference model**

```prisma
model NotificationPreference {
  id        String @id @default(cuid())
  userId    String
  user      User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  type      String
  frequency String @default("immediate")

  @@unique([userId, type])
}
```

- [ ] **Step 3: Add ShareVisit model**

```prisma
model ShareVisit {
  id           String          @id @default(cuid())
  shareId      String
  share        Share           @relation(fields: [shareId], references: [id], onDelete: Cascade)
  recipientId  String?
  recipient    ShareRecipient? @relation(fields: [recipientId], references: [id], onDelete: SetNull)
  visitorName  String?
  visitorEmail String?
  ipAddress    String?
  userAgent    String?
  action       String
  fileId       String?
  createdAt    DateTime        @default(now())

  @@index([shareId, createdAt])
}
```

- [ ] **Step 4: Modify Share model**

Add new fields (after existing fields, before relations):

```prisma
nameFieldRequired    FieldRequirement @default(HIDDEN)
emailFieldRequired   FieldRequirement @default(HIDDEN)
inactivityAlertDays  Int?
inactivityAlertSent  Boolean   @default(false)
lastDownloadedAt     DateTime?
notifyOnDownload     Boolean   @default(false)
notifiedForExpiration Boolean  @default(false)
```

Add to Share relations:
```prisma
visits               ShareVisit[]
```

- [ ] **Step 5: Modify ShareRecipient model**

Add after `email` field:
```prisma
name           String?
trackingToken  String?   @unique
notifiedAt     DateTime?
lastAccessedAt DateTime?
accessCount    Int       @default(0)
```

Add relation and unique constraint:
```prisma
visits         ShareVisit[]

@@unique([shareId, email])
```

**Note:** The `@@unique([shareId, email])` constraint will fail if duplicate (shareId, email) pairs exist. Since the project has no production data, `just db-dev-init` recreates the DB cleanly. This constraint is critical for the recipient upsert logic (Batch 7).

- [ ] **Step 6: Modify User model**

Add to User relations:
```prisma
notificationPreferences NotificationPreference[]
```

- [ ] **Step 6b: Add locale field to User model**

Add to the User model:
```prisma
locale String @default("en") // User's preferred locale for emails (ISO 639-1)
```

This field is set on registration (from the browser's Accept-Language or the frontend locale) and updatable in user settings. All `emailService.send()` calls use `user.locale` instead of hardcoding `"en"`.

- [ ] **Step 7: Add config seed entries in seed.js**

Add to the configs array (follow existing format — see `prisma/seed.js`):

```javascript
{ key: "appUrl", value: "", type: "string", group: "general", isSystem: false },
// NOTE: The existing LdapConfig.appUrl field should be migrated to use this global config key.
// In ldap/sync.scheduler.ts and any LDAP code that reads LdapConfig.appUrl, change it to read
// getConfigValue("appUrl") instead. This avoids two divergent appUrl settings.
{ key: "emailQueueIntervalSeconds", value: "30", type: "int", group: "email", isSystem: true },
{ key: "emailQueueMaxRetries", value: "3", type: "int", group: "email", isSystem: true },
{ key: "emailDigestHour", value: "8", type: "int", group: "email", isSystem: true },
{ key: "emailJobRetentionDays", value: "30", type: "int", group: "email", isSystem: true },
```

- [ ] **Step 8: Generate Prisma client and reset DB**

```bash
pnpm --filter @ouitransfer/server exec prisma generate
just db-dev-init
```

Verify: `pnpm --filter @ouitransfer/server exec prisma validate` — must succeed.

- [ ] **Step 9: Verify type-check passes**

```bash
pnpm --filter @ouitransfer/server run type-check
```

Existing code may have type errors from new required relations. Fix any — likely just adding the new relation arrays to Prisma `include` statements where needed.

- [ ] **Step 10: Commit**

```bash
git add apps/server/prisma/schema.prisma apps/server/prisma/seed.js
git commit -m "feat(email): add EmailJob, NotificationPreference, ShareVisit models + share/recipient extensions"
```
