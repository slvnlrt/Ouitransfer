# Batch 9: Identification Form + Inactivity/Expiration Schedulers

> **Depends on:** Batch 8 (visitor tracking infrastructure — identification adds identity to ShareVisit rows), Batch 1 (notifiedForExpiration, inactivityAlertSent fields in Prisma)
> **Required by:** Batch 10 (notification preferences system — preferences control what the schedulers enqueue)

**Goal:** Implement visitor identification endpoint with httpOnly cookie, IDENTIFICATION_REQUIRED gate, inactivity and expiration notification schedulers.

**Files:**
- Modify: `apps/server/src/modules/share/routes.ts`
- Modify: `apps/server/src/modules/share/service.ts`
- Create: `apps/server/src/modules/email/notification.scheduler.ts`
- Create: `apps/server/src/modules/email/__tests__/notification-scheduler.test.ts`
- Modify: `apps/server/src/server.ts`

**Reference:** Spec Sections 5 (identification, inactivity alert), 9 (identify endpoint), 10 (types 9, 12, 14).

### Steps

- [ ] **Step 1: Implement POST /shares/alias/:alias/identify**

Add to `share/routes.ts`:

```typescript
app.post("/shares/alias/:alias/identify", {
  config: { csrfProtection: false }, // Public endpoint, visitor has no session
  schema: {
    params: z.object({ alias: z.string() }),
    body: z.object({
      name: z.string().max(100).optional(),
      email: z.string().email().max(254).optional(),
    }),
  },
  handler: async (request, reply) => {
    const { alias } = request.params;
    const share = await shareService.getShareMetadataByAlias(alias);

    // Validate required fields against share settings
    if (share.nameFieldRequired === "REQUIRED" && !request.body.name) {
      throw new ValidationError("Name is required");
    }
    if (share.emailFieldRequired === "REQUIRED" && !request.body.email) {
      throw new ValidationError("Email is required");
    }

    // Sign cookie payload
    const payload = {
      alias,
      name: request.body.name ?? null,
      email: request.body.email ?? null,
    };

    // Set httpOnly signed cookie (Fastify @fastify/cookie handles signing)
    reply.setCookie(`sv_${alias}`, JSON.stringify(payload), {
      path: "/api",
      httpOnly: true,
      sameSite: "strict",
      secure: env.SECURE_SITE !== "false",
      signed: true,
      maxAge: 86400, // 24 hours
    });

    return { success: true };
  },
});
```

  Rate limiting: Use `@fastify/rate-limit` (already in the project). Apply per-route config:
  ```typescript
  config: {
    rateLimit: {
      max: 30,
      timeWindow: "1 hour",
      keyGenerator: (req: FastifyRequest) => `${req.ip}:${(req.params as { alias: string }).alias}`,
    },
  },
  ```

- [ ] **Step 2: Add IDENTIFICATION_REQUIRED gate to share access**

In the `getShare()` / `getShareByAlias()` flow (after password check, before returning content):

```typescript
// Check if identification is required and not yet provided
if (
  !isOwner &&
  (share.nameFieldRequired === "REQUIRED" || share.emailFieldRequired === "REQUIRED")
) {
  const hasTrackingToken = !!context?.trackingToken;
  const hasVisitorCookie = !!context?.visitorCookie;

  // Token holders skip ONLY if all required fields are satisfied
  let tokenSatisfiesRequirements = false;
  if (hasTrackingToken) {
    const recipient = await prisma.shareRecipient.findUnique({
      where: { trackingToken: context.trackingToken },
    });
    tokenSatisfiesRequirements =
      (share.nameFieldRequired !== "REQUIRED" || !!recipient?.name) &&
      (share.emailFieldRequired !== "REQUIRED" || !!recipient?.email);
  }

  if (!tokenSatisfiesRequirements && !hasVisitorCookie) {
    throw new AppError(403, "Identification required", ErrorCodes.IDENTIFICATION_REQUIRED);
  }
}
```

Read the `sv_{alias}` cookie from the request in the route handler:
```typescript
const visitorCookieRaw = request.cookies[`sv_${alias}`];
const visitorCookie = visitorCookieRaw ? parseSignedCookie(visitorCookieRaw) : undefined;
```

**Cookie parsing:** Read and verify the `sv_{alias}` cookie in the route handler before calling the service:

```typescript
function parseVisitorCookie(request: FastifyRequest, alias: string): VisitorCookiePayload | undefined {
  const raw = request.cookies[`sv_${alias}`];
  if (!raw) return undefined;
  const unsigned = request.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return undefined;
  try {
    const payload = JSON.parse(unsigned.value) as VisitorCookiePayload;
    if (payload.alias !== alias) return undefined; // defense in depth
    return payload;
  } catch {
    return undefined; // malformed cookie — silently ignore
  }
}
```

- [ ] **Step 3: Implement notification scheduler**

Create `notification.scheduler.ts` — runs daily, checks for expiring shares/reverse shares and inactive shares:

```typescript
// Follows the same chained setTimeout pattern as audit/retention.scheduler.ts

export async function checkExpiringShares(): Promise<void> {
  // Read autoCleanupNotifyDaysBefore config (default 3)
  // Find shares: expiration IS NOT NULL AND expiration BETWEEN now AND now+days AND notifiedForExpiration=false AND creatorId IS NOT NULL
  // For each: emailService.send("share_expiring", ...) + set notifiedForExpiration=true
}

export async function checkExpiredShares(): Promise<void> {
  // Find shares: expired (expiration < now) AND notifiedForExpiration=false AND creatorId IS NOT NULL
  // For each: emailService.send("share_expired", ...) + set notifiedForExpiration=true
}

export async function checkInactiveShares(): Promise<void> {
  // Find shares: inactivityAlertDays IS NOT NULL AND inactivityAlertSent=false
  //   AND (lastDownloadedAt IS NULL OR lastDownloadedAt < now - inactivityAlertDays days)
  //   AND creatorId IS NOT NULL
  // For each: emailService.send("share_no_activity", ...) + set inactivityAlertSent=true
}

// Same checks for reverse shares (types 14, 15)
export async function checkExpiringReverseShares(): Promise<void> { /* ... */ }
export async function checkExpiredReverseShares(): Promise<void> { /* ... */ }

export async function initNotificationSchedulerOnBoot(): Promise<void>
export function stopNotificationScheduler(): void
```

- [ ] **Step 4: Handle notifiedForExpiration reset on share update**

In `share/service.ts` `updateShare()`:
```typescript
if (data.expiration && share.expiration) {
  const newExp = new Date(data.expiration);
  if (newExp > share.expiration) {
    // Expiration extended — allow re-notification
    updateData.notifiedForExpiration = false;
  }
}
```

The `inactivityAlertSent` reset is already handled in Batch 8 (when `lastDownloadedAt` is updated on non-owner download).

- [ ] **Step 5: Register scheduler in server.ts**

```typescript
import { initNotificationSchedulerOnBoot, stopNotificationScheduler } from "./modules/email/notification.scheduler.js";

// After existing scheduler inits:
void initNotificationSchedulerOnBoot();

// onClose:
app.addHook("onClose", () => stopNotificationScheduler());
```

- [ ] **Step 6: Write tests**

```typescript
describe("identification", () => {
  it("POST /shares/alias/:alias/identify sets signed httpOnly cookie, returns success");
  it("POST /shares/alias/:alias/identify with missing required name → 400");
  it("accessing share requiring identification without cookie/token → 403 IDENTIFICATION_REQUIRED");
  it("accessing with valid sv_{alias} cookie → passes through, records visitor info in ShareVisit");
  it("tracking token satisfies identification when all required fields present");
  it("tracking token does NOT satisfy when name is REQUIRED but recipient has no name → form shown");
});

describe("notification scheduler", () => {
  it("checkExpiringShares sends share_expiring and sets notifiedForExpiration");
  it("checkExpiringShares skips already-notified shares");
  it("checkExpiredShares sends share_expired");
  it("checkInactiveShares sends share_no_activity and sets inactivityAlertSent");
  it("extending share expiration resets notifiedForExpiration");
  it("download resets inactivityAlertSent");
  it("owner download does NOT reset inactivityAlertSent");
});
```

- [ ] **Step 7: Run tests**

```bash
pnpm --filter @ouitransfer/server test
```

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/modules/share/ apps/server/src/modules/email/notification.scheduler.ts apps/server/src/modules/email/__tests__/notification-scheduler.test.ts apps/server/src/server.ts
git commit -m "feat(email): add visitor identification, inactivity and expiration notification schedulers"
```
