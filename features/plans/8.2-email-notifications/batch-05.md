# Batch 5: Email Queue Scheduler

> **Depends on:** Batch 4 (EmailService + emailQueueEvents — queue imports both), Batch 2 (SmtpTransport — queue sends via it)
> **Required by:** Batch 6 (validateAllI18nKeys called from initEmailQueueOnBoot), Batch 7+ (all email sending flows through queue)

**Goal:** Implement the queue scheduler that polls `EmailJob`, sends via `SmtpTransport`, handles retry/cleanup/wake-up.

**Files:**
- Create: `apps/server/src/modules/email/queue.ts`
- Create: `apps/server/src/modules/email/__tests__/queue.test.ts`
- Modify: `apps/server/src/server.ts`

**Reference:** Spec Section 4, existing scheduler pattern at `modules/audit/retention.scheduler.ts`.

### Steps

- [ ] **Step 1: Write queue tests**

```typescript
describe("EmailQueueScheduler", () => {
  // Mock SmtpTransport.sendMail, prisma
  it("processBatch() picks up pending jobs where nextAttemptAt <= now, ordered by priority DESC, createdAt ASC");
  it("processBatch() locks each job (status='processing', lockedAt=now) before sending");
  it("processBatch() marks job 'sent' with sentAt on successful send");
  it("processBatch() on SMTP failure: increments attempts, sets nextAttemptAt with exponential backoff");
  it("processBatch() backoff delays: 1min, 5min, 30min");
  it("processBatch() marks job 'failed' permanently when attempts >= maxAttempts");
  it("processBatch() handles batch of up to 10 jobs");
  it("recoverStuckJobs() resets 'processing' jobs older than 5 minutes to 'pending'");
  it("cleanupSentJobs() deletes 'sent' jobs older than emailJobRetentionDays");
  it("wake event triggers immediate poll");
  it("start()/stop() properly manage timeouts and event listeners");
  it("stop() removes wake listener (no listener leak)");
});
```

- [ ] **Step 2: Implement queue scheduler**

**Note:** `initEmailQueueOnBoot()` does NOT call `validateAllI18nKeys()` — that is deferred to Batch 6 Step 9 when all i18n keys are in place.

Follow the chained `setTimeout` pattern from `audit/retention.scheduler.ts` (see `apps/server/src/modules/audit/retention.scheduler.ts`):

```typescript
// queue.ts — key exports:
export async function startEmailQueueScheduler(): Promise<void>
export function stopEmailQueueScheduler(): void
export async function initEmailQueueOnBoot(): Promise<void>

// Internal:
// - scheduleNext(intervalMs) — chained setTimeout
// - processTick() — calls processBatch() + periodic cleanupSentJobs()
// - processBatch() — select pending jobs, lock, send, update status
// - cleanupSentJobs() — delete old sent jobs (hourly)
// - recoverStuckJobs() — reset stuck processing jobs (on boot)
// - onWake() — listener for emailQueueEvents "wake" — triggers immediate tick
```

Key implementation details:
- `processBatch()` sends ONE job at a time (sequential within batch) — SQLite doesn't benefit from concurrent writes
- Locking: `UPDATE EmailJob SET status='processing', lockedAt=now() WHERE id=? AND status='pending'`
- Exponential backoff: `[60, 300, 1800]` seconds for attempts 1/2/3
- Cleanup runs every ~120 ticks (once per hour at 30s interval) — use a tick counter
- Wake handler: clears current timeout, schedules immediate tick (setTimeout 0), then resumes normal interval
- The interval is re-read from config on every tick (via `getIntervalMs()`) so admin config changes take effect without server restart.
- Define `STUCK_JOB_TIMEOUT_MS = 5 * 60_000` and `CLEANUP_EVERY_N_TICKS = 120` as named constants at the top of `queue.ts`.

- [ ] **Step 3: Register in server.ts**

Add to imports at top of `server.ts`:
```typescript
import { initEmailQueueOnBoot, stopEmailQueueScheduler } from "./modules/email/queue.js";
```

After existing scheduler inits (~line 108):
```typescript
void initEmailQueueOnBoot();
```

Add onClose hook (~line 166):
```typescript
app.addHook("onClose", () => stopEmailQueueScheduler());
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @ouitransfer/server test -- --run src/modules/email/__tests__/queue.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/modules/email/queue.ts apps/server/src/modules/email/__tests__/queue.test.ts apps/server/src/server.ts
git commit -m "feat(email): add EmailQueueScheduler with retry, cleanup, and wake-up signal"
```
