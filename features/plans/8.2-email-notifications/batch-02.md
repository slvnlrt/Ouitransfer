# Batch 2: SmtpTransport

> **Depends on:** Batch 1 (Prisma schema + config seed — SmtpTransport reads SMTP config from DB)
> **Required by:** Batch 5 (EmailQueueScheduler uses SmtpTransport to send), Batch 7 (testConnection caller update)

**Goal:** Replace duplicated `createTransporter()` logic with a pooled, config-hash-aware SMTP transport class.

**Files:**
- Create: `apps/server/src/modules/email/transport.ts`
- Create: `apps/server/src/modules/email/__tests__/transport.test.ts`

**Reference:** Spec Section 1 (SmtpTransport), current `email/service.ts` lines 31-88 for the config loading logic to replicate.

### Steps

- [ ] **Step 1: Write failing tests**

Test cases (mock `getConfigValue` and `nodemailer.createTransport`):

```typescript
describe("SmtpTransport", () => {
  it("creates a pooled nodemailer transporter on first getTransporter() call");
  it("reuses the same transporter when SMTP config has not changed");
  it("recreates the transporter when SMTP config changes (hash mismatch)");
  it("testConnection() returns { success: true } when SMTP server verifies");
  it("testConnection() returns { success: false, message } on SMTP error");
  it("sendMail() calls transporter.sendMail with from address from config");
  it("sendMail() logs duration and recipient via Pino");
  it("sendMail() re-throws transport errors for caller handling");
  it("getTransporter() reads all SMTP config keys from DB");
  it("handles smtpSecure='ssl' / 'tls' / 'none' / 'auto' modes correctly");
  it("handles smtpNoAuth='true' (skips auth credentials)");
  it("handles smtpTrustSelfSigned='true' (rejectUnauthorized: false)");
  it("close() disposes the transporter and clears the hash");
});
```

Run: `pnpm --filter @ouitransfer/server test -- --run src/modules/email/__tests__/transport.test.ts`
Expected: FAIL (transport.ts doesn't exist yet)

- [ ] **Step 2: Implement SmtpTransport**

Create `transport.ts`. The `loadConfig()` method must replicate the exact SMTP configuration logic from the current `email/service.ts` lines 31-88 (host, port, secure mode handling, auth, TLS settings). Key design:

```typescript
export class SmtpTransport {
  private transporter: Transporter | null = null;
  private configHash: string | null = null;

  async getTransporter(): Promise<Transporter> { /* pool + hash check */ }
  async testConnection(overrideConfig?: Partial<SmtpConfig>): Promise<{ success: boolean; message: string }> { /* ... */ }
  async sendMail(options: SendMailOptions): Promise<void> { /* with logging */ }
  private async loadConfig(): Promise<SmtpConfig> { /* from DB config values */ }
  private hashConfig(config: SmtpConfig): string { /* SHA-256 */ }
  close(): void { /* dispose pool */ }
}

export const smtpTransport = new SmtpTransport();
```

Read `apps/server/src/modules/email/service.ts` lines 31-130 for the complete SMTP config logic — replicate it exactly in `loadConfig()`, removing the duplication between the send path and `testConnection()`.

- [ ] **Step 3: Run tests to verify they pass**

```bash
pnpm --filter @ouitransfer/server test -- --run src/modules/email/__tests__/transport.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/modules/email/transport.ts apps/server/src/modules/email/__tests__/transport.test.ts
git commit -m "feat(email): add SmtpTransport with connection pooling and config hash"
```
