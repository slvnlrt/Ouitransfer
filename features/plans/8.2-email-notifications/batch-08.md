# Batch 8: Visitor Tracking + Download Tracking

> **Depends on:** Batch 7 (migration complete — share service uses new emailService), Batch 1 (ShareVisit model in Prisma)
> **Required by:** Batch 9 (identification form uses ShareVisit + visitor cookie, inactivity scheduler reads lastDownloadedAt)

**Goal:** Record `ShareVisit` entries on share access and file downloads. Resolve tracking tokens. Update `lastDownloadedAt`.

**Files:**
- Modify: `apps/server/src/modules/share/service.ts`
- Modify: `apps/server/src/modules/share/routes.ts`
- Modify: `apps/server/src/modules/share/dto.ts`
- Modify: `apps/server/src/modules/file/routes.ts`
- Create: share visits query route

**Reference:** Spec Section 5 (visitor tracking, notification triggers), Section 9 (modified endpoints).

### Steps

- [ ] **Step 1: Add context parameter to getShare/getShareByAlias**

Extend the service methods to accept visitor context:

```typescript
interface ShareAccessContext {
  trackingToken?: string;  // from ?t= query param
  visitorCookie?: VisitorCookiePayload; // from sv_{alias} cookie (Batch 9)
  ipAddress?: string;
  userAgent?: string;
}
```

Pass this context from the route handlers.

**Caller update:** Adding the `context` parameter to `getShare()` / `getShareByAlias()` requires updating ALL callers. Run `grep -r "getShare\|getShareByAlias" apps/server/src` to find them. Use an optional parameter or options object to avoid breaking existing callers:

```typescript
async getShare(shareId: string, password?: string, userId?: string, context?: ShareAccessContext)
```

The existing callers pass `undefined` for `context` — they continue to work unchanged. Only the route handlers for public share access pass the full context.

- [ ] **Step 2: Record ShareVisit on non-owner share access**

In `getShare()` / `getShareByAlias()`, after the owner check and before returning:

```typescript
// Only for non-owner accesses (not metadata probes)
if (!isOwner) {
  // Resolve visitor identity from tracking token
  let recipientId: string | undefined;
  let visitorName: string | undefined;
  let visitorEmail: string | undefined;

  if (context?.trackingToken) {
    const recipient = await prisma.shareRecipient.findUnique({
      where: { trackingToken: context.trackingToken },
    });
    if (recipient && recipient.shareId === share.id) {
      recipientId = recipient.id;
      visitorEmail = recipient.email;
      visitorName = recipient.name ?? undefined;
      // Update recipient stats
      await prisma.shareRecipient.update({
        where: { id: recipient.id },
        data: { lastAccessedAt: new Date(), accessCount: { increment: 1 } },
      });
    }
  }

  // Or from identification cookie (Batch 9 wires this)
  if (!recipientId && context?.visitorCookie) {
    visitorName = context.visitorCookie.name;
    visitorEmail = context.visitorCookie.email;
  }

  await prisma.shareVisit.create({
    data: {
      shareId: share.id,
      recipientId,
      visitorName,
      visitorEmail,
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
      action: "access",
    },
  });

  // Trigger share_accessed notification (if creator has it enabled)
  if (share.creatorId) {
    emailService.send("share_accessed", {
      to: share.creator!.email!,
      locale: "en",
      userId: share.creatorId,
      data: {
        shareName: share.name ?? "Unnamed share",
        visitorName,
        visitorEmail,
        ipAddress: context?.ipAddress,
        accessedAt: new Date().toISOString(),
      },
    }).catch((err) => getLogger().error({ err }, "Failed to send share_accessed notification"));
  }
}
```

- [ ] **Step 3: Handle tracking token query param in share routes**

Modify `GET /shares/alias/:alias` and `POST /shares/alias/:alias/access` routes:
- Read `?t=` query parameter
- Pass to service as `context.trackingToken`
- Pass `request.ip` and `request.headers["user-agent"]` as context

- [ ] **Step 4: Add shareId to download endpoints**

Modify `POST /files/download-url` in `file/routes.ts`:
- Extend body schema: add `shareId: z.string().optional()`
- When `shareId` is provided:
  1. Verify the file belongs to the share (check `ShareFiles` join table)
  2. If valid and requester is not the owner:
     - Create `ShareVisit` with `action: "download"` and `fileId`
     - Update `share.lastDownloadedAt = new Date()`
     - Send `share_downloaded` notification

Do the same for `POST /files/download` (streaming endpoint).

- [ ] **Step 5: Update share DTOs**

In `share/dto.ts`:

Add to `CreateShareSchema` and `UpdateShareSchema`:
```typescript
nameFieldRequired: z.nativeEnum(FieldRequirement).optional(),
emailFieldRequired: z.nativeEnum(FieldRequirement).optional(),
notifyOnDownload: z.boolean().optional(),
inactivityAlertDays: z.number().int().positive().nullable().optional(),
```

Update `ShareResponseSchema` to include all new fields:
```typescript
nameFieldRequired: z.nativeEnum(FieldRequirement),
emailFieldRequired: z.nativeEnum(FieldRequirement),
notifyOnDownload: z.boolean(),
inactivityAlertDays: z.number().nullable(),
lastDownloadedAt: z.string().datetime().nullable(),
notifiedForExpiration: z.boolean(),
```

Also update `ShareRecipientSchema` (inside ShareResponseSchema):
```typescript
name: z.string().nullable(),
trackingToken: z.string().nullable(), // only visible to share creator
notifiedAt: z.string().datetime().nullable(),
lastAccessedAt: z.string().datetime().nullable(),
accessCount: z.number(),
```

- [ ] **Step 6: Add GET /shares/:shareId/visits endpoint**

New route (in share/routes.ts):
```typescript
app.get("/shares/:shareId/visits", {
  preHandler: [requireAuth],
  schema: {
    params: z.object({ shareId: z.string() }),
    querystring: z.object({
      action: z.enum(["access", "download"]).optional(),
      page: z.coerce.number().int().positive().default(1),
      limit: z.coerce.number().int().positive().max(100).default(20),
    }),
  },
  handler: async (request) => {
    // Verify requester is the share creator
    // Query ShareVisit with filters, pagination, include recipient
    // Return { visits: ShareVisit[], total, page, limit }
  },
});
```

- [ ] **Step 7: Write integration tests**

```typescript
describe("visitor tracking", () => {
  it("accessing share by alias creates ShareVisit with action 'access'");
  it("accessing with ?t=TOKEN resolves recipientId, updates recipient stats");
  it("owner accessing own share does NOT create ShareVisit");
  it("metadata endpoint does NOT create ShareVisit");
  it("POST /files/download-url with shareId creates ShareVisit action 'download'");
  it("POST /files/download-url with shareId updates share.lastDownloadedAt");
  it("POST /files/download-url without shareId does NOT create ShareVisit");
  it("POST /files/download-url with invalid shareId (file not in share) silently ignores");
  it("GET /shares/:shareId/visits returns paginated visits (creator only)");
  it("GET /shares/:shareId/visits rejected for non-creator");
  it("new share fields appear in ShareResponseSchema");
  it("lastDownloadedAt tracks URL issuance time, not actual download (documented limitation)");
});
```

- [ ] **Step 8: Run tests**

```bash
pnpm --filter @ouitransfer/server test
```

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/modules/share/ apps/server/src/modules/file/routes.ts
git commit -m "feat(email): add visitor tracking on share access and file downloads"
```
