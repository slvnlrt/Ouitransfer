# Batch 7: Migration + Bug Fixes + Recipient Upsert

> **Depends on:** Batch 6 (all 22 templates complete + catalog wired with real renders)
> **Required by:** Batch 8 (visitor tracking builds on the migrated share service), Batch 9+ (all subsequent batches assume old EmailService is deleted)

**Goal:** Migrate all 4 existing email callers to the new `emailService.send()`, delete the old monolithic EmailService, fix 5 MVP bugs, implement recipient upsert to preserve tracking tokens.

**Files:**
- Modify: `apps/server/src/modules/auth/service.ts`
- Modify: `apps/server/src/modules/ldap/sync.scheduler.ts`
- Modify: `apps/server/src/modules/share/service.ts`
- Modify: `apps/server/src/modules/share/routes.ts`
- Modify: `apps/server/src/modules/share/dto.ts`
- Modify: `apps/server/src/modules/share/repository.ts`
- Delete: old monolithic `EmailService` class (now fully replaced)
- Create/modify: integration tests

**Reference:** Spec Section 7 (migration), Section 5 (bug fixes, recipient upsert).

### Steps

- [ ] **Step 1: Migrate password reset in auth/service.ts**

Find the `sendPasswordResetEmail()` call. Replace with:

```typescript
import { emailService } from "../email/service.js";

// In the password reset method:
await emailService.send("password_reset", {
  to: user.email,
  locale: user.locale ?? "en",
  data: {
    resetUrl: `${origin}/auth/reset-password/${resetToken}`,
    expiresInMinutes: 60,
  },
});
```

Remove the `EmailService` class instantiation (`private emailService = new EmailService()`) and replace with the imported `emailService` singleton from `email/email-service.js`.

- [ ] **Step 2: Migrate LDAP welcome in ldap/sync.service.ts**

Replace `sendLdapWelcomeEmail(email, setPasswordUrl)` with:

```typescript
import { emailService } from "../email/service.js";

await emailService.send("welcome", {
  to: email,
  locale: user.locale ?? "en",
  data: { firstName: user.firstName ?? user.username, loginUrl: setPasswordUrl },
});
```

- [ ] **Step 3: Implement recipient upsert in share/repository.ts**

Add new repository methods:

```typescript
async getRecipientsByShare(shareId: string): Promise<ShareRecipient[]> {
  return prisma.shareRecipient.findMany({ where: { shareId } });
}

async removeRecipientsById(shareId: string, recipientIds: string[]): Promise<void> {
  await prisma.shareRecipient.deleteMany({
    where: { shareId, id: { in: recipientIds } },
  });
}

async addRecipientsWithTokens(shareId: string, emails: string[]): Promise<ShareRecipient[]> {
  // Create recipients with tracking tokens generated at creation time
  const recipients = [];
  for (const email of emails) {
    const trackingToken = crypto.randomBytes(24).toString("base64url");
    const recipient = await prisma.shareRecipient.create({
      data: { shareId, email, trackingToken },
    });
    recipients.push(recipient);
  }
  return recipients;
}
```

- [ ] **Step 4: Replace delete+recreate with upsert in share/service.ts updateShare()**

Replace the existing recipient handling in `updateShare()` (~lines 258-264):

```typescript
if (recipients !== undefined) {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.shareRecipient.findMany({ where: { shareId } });
    const existingByEmail = new Map(existing.map((r) => [r.email, r]));
    const newEmailSet = new Set(recipients);

    // Remove recipients no longer in the list
    const toRemove = existing.filter((r) => !newEmailSet.has(r.email));
    if (toRemove.length > 0) {
      await tx.shareRecipient.deleteMany({
        where: { shareId, id: { in: toRemove.map((r) => r.id) } },
      });
    }

    // Add new recipients with tracking tokens
    const toAdd = recipients.filter((email) => !existingByEmail.has(email));
    for (const email of toAdd) {
      const trackingToken = crypto.randomBytes(24).toString("base64url");
      await tx.shareRecipient.create({ data: { shareId, email, trackingToken } });
    }
    // Existing recipients are untouched — tokens, notifiedAt, stats preserved
  });
}
```

- [ ] **Step 5: Migrate share notification + fix MVP bugs**

Rewrite `notifyRecipients()` in `share/service.ts`:

```typescript
async notifyRecipients(
  shareId: string,
  userId: string,
  shareLink: string,
  selectedEmails?: string[], // Bug fix #1: selective notify
): Promise<{ notifiedRecipients: string[] }> {
  const share = await this.shareRepository.getShare(shareId, { recipients: true });
  if (!share) throw new NotFoundError("Share not found");
  if (share.creatorId !== userId) throw new ForbiddenError("Not share owner");

  // Filter to selected emails if provided (Bug fix #1 + #2)
  let recipientsToNotify = share.recipients;
  if (selectedEmails?.length) {
    const emailSet = new Set(selectedEmails);
    recipientsToNotify = share.recipients.filter((r) => emailSet.has(r.email));
  }

  // Get sender info
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const senderName = user?.firstName ? `${user.firstName} ${user.lastName ?? ""}`.trim() : user?.username ?? "Someone";

  const notifiedRecipients: string[] = [];
  for (const recipient of recipientsToNotify) {
    // Ensure tracking token exists
    let trackingToken = recipient.trackingToken;
    if (!trackingToken) {
      trackingToken = crypto.randomBytes(24).toString("base64url");
      await prisma.shareRecipient.update({
        where: { id: recipient.id },
        data: { trackingToken },
      });
    }

    const personalizedLink = `${shareLink}?t=${trackingToken}`;
    try {
      await emailService.send("share_invitation", {
        to: recipient.email,
        locale: user?.locale ?? "en",
        data: {
          senderName,
          shareName: share.name ?? "Shared files",
          shareLink: personalizedLink,
          hasPassword: !!share.security?.password,
          expiresAt: share.expiration?.toISOString(),
        },
      });

      // Bug fix #3: track notification time
      await prisma.shareRecipient.update({
        where: { id: recipient.id },
        data: { notifiedAt: new Date() },
      });

      notifiedRecipients.push(recipient.email);
    } catch (error) {
      getLogger().error({ err: error, email: recipient.email }, "Failed to queue share invitation");
    }
  }

  return { notifiedRecipients };
}
```

- [ ] **Step 6: Fix notify route in share/routes.ts**

Update the `POST /shares/:shareId/notify` route to accept optional `emails`:

```typescript
const NotifyBodySchema = z.object({
  shareLink: z.string().url(),
  emails: z.array(z.string().email()).optional(), // Bug fix #1
});
```

Pass `emails` to `notifyRecipients()`:
```typescript
const result = await shareService.notifyRecipients(shareId, userId, body.shareLink, body.emails);
```

- [ ] **Step 7: Migrate reverse share notification in share/routes.ts**

Find the `sendReverseShareBatchFileNotification()` call and replace with:

```typescript
await emailService.send("reverse_share_uploaded", {
  to: reverseShare.creator.email,
  locale: reverseShare.creator.locale ?? "en",
  userId: reverseShare.creatorId,
  data: {
    reverseShareName: reverseShare.name,
    fileCount,
    fileList,
    uploaderName: uploaderName ?? undefined,
    uploaderEmail: uploaderEmail ?? undefined,
  },
});
```

- [ ] **Step 8: Delete old EmailService**

The old `email/service.ts` class (monolithic, 389 lines) can now be deleted. All 4 callers have been migrated. Ensure no imports remain pointing to the old class.

If the new `service.ts` was created alongside (e.g., `service.new.ts`), rename it back to `service.ts`.

Also clean up old test files that tested the monolithic class.

- [ ] **Step 9: Update the `testConnection` caller**

The existing SMTP test button in admin settings calls the old `emailService.testConnection()`. Update it to use `smtpTransport.testConnection()` from the new transport module.

- [ ] **Step 10: Write integration tests**

```typescript
describe("email migration integration", () => {
  it("POST /shares/:shareId/notify creates EmailJob rows (not direct SMTP)");
  it("POST /shares/:shareId/notify with { emails } only notifies selected recipients");
  it("POST /shares/:shareId/notify sets notifiedAt on each notified recipient");
  it("POST /shares/:shareId/notify generates tracking tokens for recipients without one");
  it("share update preserves existing recipient tracking tokens and stats");
  it("share update removes deleted recipients and adds new ones");
  it("password reset creates EmailJob with priority 1");
  it("POST /auth/reset-password triggers password_reset email");
});
```

Use `app.inject()` for these. Check `EmailJob` table after each call.

- [ ] **Step 11: Run full test suite**

```bash
pnpm --filter @ouitransfer/server test
```

All existing tests must pass + new integration tests.

- [ ] **Step 12: Commit**

```bash
git add apps/server/src/modules/auth/ apps/server/src/modules/ldap/ apps/server/src/modules/share/ apps/server/src/modules/email/
git commit -m "feat(email): migrate all callers to new system, fix 5 MVP bugs, implement recipient upsert"
```
