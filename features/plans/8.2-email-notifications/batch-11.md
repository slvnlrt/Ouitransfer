# Batch 11: Admin Email Endpoints

> **Depends on:** Batch 10 (notification routes file already created — admin endpoints added to it), Batch 4 (emailService.send used for test email)
> **Required by:** Batch 12 (frontend admin email section calls these endpoints)

**Goal:** Add admin email queue stats and test email endpoints.

**Files:**
- Modify: `apps/server/src/modules/notification/routes.ts` (add admin endpoints)
- Modify tests

**Reference:** Spec Section 9 (admin endpoints).

### Steps

- [ ] **Step 1: Add GET /admin/email/stats**

In `notification/routes.ts` (or in a separate admin email routes file):

```typescript
app.get("/admin/email/stats", {
  preHandler: [requireAuth, requireAdmin],
}, async () => {
  const [pending, sentLast24h, failed] = await Promise.all([
    prisma.emailJob.count({ where: { status: "pending" } }),
    prisma.emailJob.count({
      where: { status: "sent", sentAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    }),
    prisma.emailJob.count({ where: { status: "failed" } }),
  ]);
  return { pending, sentLast24h, failed };
});
```

- [ ] **Step 2: Add POST /admin/email/test**

```typescript
app.post("/admin/email/test", {
  preHandler: [requireAuth, requireAdmin],
  schema: {
    body: z.object({ to: z.string().email() }),
  },
}, async (request) => {
  await emailService.send("test_email", {
    to: request.body.to,
    locale: "en",
    data: { recipientEmail: request.body.to },
  });
  return { success: true, message: "Test email queued" };
});
```

- [ ] **Step 3: Write tests**

```typescript
describe("admin email endpoints", () => {
  it("GET /admin/email/stats returns counters");
  it("GET /admin/email/stats rejected for non-admin");
  it("POST /admin/email/test creates priority 1 EmailJob");
  it("POST /admin/email/test rejected for non-admin");
  it("POST /admin/email/test with invalid email → 400");
});
```

- [ ] **Step 4: Run tests and commit**

```bash
pnpm --filter @ouitransfer/server test
git add apps/server/src/modules/notification/
git commit -m "feat(email): add admin email stats and test email endpoints"
```
