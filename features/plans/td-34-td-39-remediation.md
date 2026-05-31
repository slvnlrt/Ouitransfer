# TD-34 + TD-39 Remediation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two high/medium-priority tech debt items — TD-34 (add per-reverse-share `notifyOnUpload` toggle) and TD-39 (hash password reset tokens with SHA-256 before storage).

**Architecture:**
- TD-34 mirrors the existing `notifyOnDownload` pattern on shares: new Prisma field, DTOs, `resolveFrequency` branch, frontend toggle, i18n keys.
- TD-39 adds a shared `hashToken()` utility and hashes tokens before DB storage / lookup; normalizes token entropy to 32 bytes across auth and LDAP.

**Tech Stack:** Prisma (SQLite), Fastify + Zod, Next.js + React Hook Form + shadcn/ui, Vitest

**Verification commands:**
- `pnpm --filter server exec prisma generate` — regenerate Prisma client
- `pnpm --filter server test` — server unit/integration tests
- `pnpm --filter web run type-check` — frontend type check
- `pnpm --filter server run type-check` — server type check

---

## Task 1: TD-39 — Create `hashToken` utility + unit test

**Files:**
- Create: `apps/server/src/utils/token-hash.ts`
- Create: `apps/server/src/utils/__tests__/token-hash.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/utils/__tests__/token-hash.test.ts`:

```typescript
import crypto from "node:crypto";
import { describe, expect, it } from "vitest";

import { hashToken } from "../token-hash.js";

describe("hashToken", () => {
  it("returns a 64-char hex SHA-256 digest", () => {
    const token = crypto.randomBytes(32).toString("hex");
    const hash = hashToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic (same input → same output)", () => {
    const token = "abc123";
    expect(hashToken(token)).toBe(hashToken(token));
  });

  it("produces different hashes for different inputs", () => {
    expect(hashToken("token-a")).not.toBe(hashToken("token-b"));
  });

  it("matches manual SHA-256 computation", () => {
    const token = "test-token-value";
    const expected = crypto.createHash("sha256").update(token).digest("hex");
    expect(hashToken(token)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter server test -- src/utils/__tests__/token-hash.test.ts`
Expected: FAIL — module `../token-hash.js` not found.

- [ ] **Step 3: Write the implementation**

Create `apps/server/src/utils/token-hash.ts`:

```typescript
import crypto from "node:crypto";

/**
 * Hashes a token using SHA-256.
 * Used for password reset tokens: the raw token is sent to the user via email,
 * but only the hash is stored in the database. On verification, the incoming
 * token is hashed and compared against the stored hash.
 */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter server test -- src/utils/__tests__/token-hash.test.ts`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```
git add apps/server/src/utils/token-hash.ts apps/server/src/utils/__tests__/token-hash.test.ts
git commit -m "feat(server): add hashToken utility for SHA-256 token hashing (TD-39)"
```

---

## Task 2: TD-39 — Hash tokens in auth service + update tests

**Files:**
- Modify: `apps/server/src/modules/auth/service.ts` (lines 181, 184-187, 215-217)
- Modify: `apps/server/src/modules/auth/__tests__/password-reset-url.test.ts`

- [ ] **Step 1: Update auth service to hash tokens**

In `apps/server/src/modules/auth/service.ts`:

1. Add import at top (with the other `node:crypto` import area):
```typescript
import { hashToken } from "../../utils/token-hash.js";
```

2. In `requestPasswordReset` (around line 181-190), change token size and hash before storing:

Replace:
```typescript
    const token = crypto.randomBytes(128).toString("hex");
    const expirationSeconds = Number(await getConfigValue("passwordResetTokenExpiration"));

    await prisma.passwordReset.create({
      data: {
        userId: user.id,
        token,
        expiresAt: new Date(Date.now() + expirationSeconds * 1000),
      },
    });
```

With:
```typescript
    const token = crypto.randomBytes(32).toString("hex");
    const expirationSeconds = Number(await getConfigValue("passwordResetTokenExpiration"));

    await prisma.passwordReset.create({
      data: {
        userId: user.id,
        token: hashToken(token),
        expiresAt: new Date(Date.now() + expirationSeconds * 1000),
      },
    });
```

Note: `crypto.randomBytes(128)` was overkill (256 hex chars). `crypto.randomBytes(32)` provides 256 bits of entropy — more than sufficient and consistent with LDAP service.

3. In `resetPassword` (around line 215-226), hash the incoming token before DB lookup:

Replace:
```typescript
    const resetRequest = await prisma.passwordReset.findFirst({
      where: {
        token,
        used: false,
```

With:
```typescript
    const resetRequest = await prisma.passwordReset.findFirst({
      where: {
        token: hashToken(token),
        used: false,
```

- [ ] **Step 2: Update password-reset-url tests**

In `apps/server/src/modules/auth/__tests__/password-reset-url.test.ts`:

No mock changes needed — the test already mocks `prisma.passwordReset.create` and `buildResetPasswordUrl`. The token is passed raw to `buildResetPasswordUrl` (correct — raw token goes in the email URL) and the hash is stored in DB (which is a mock). The existing test assertions check that `buildResetPasswordUrl` is called with `expect.any(String)` and that the email is sent — both remain valid.

Verify by running the tests.

- [ ] **Step 3: Run the full auth test suite**

Run: `pnpm --filter server test -- src/modules/auth/__tests__/`
Expected: All tests PASS.

- [ ] **Step 4: Commit**

```
git add apps/server/src/modules/auth/service.ts apps/server/src/modules/auth/__tests__/password-reset-url.test.ts
git commit -m "feat(server): hash password reset tokens with SHA-256 before storage (TD-39)"
```

---

## Task 3: TD-39 — Hash tokens in LDAP sync service + normalize entropy + update tests

**Files:**
- Modify: `apps/server/src/modules/ldap/sync.service.ts` (lines 360-371)
- Modify: `apps/server/src/modules/ldap/__tests__/sync.service.test.ts`

- [ ] **Step 1: Update LDAP sync service**

In `apps/server/src/modules/ldap/sync.service.ts`:

1. Add import near top (with other imports):
```typescript
import { hashToken } from "../../utils/token-hash.js";
```

2. Replace the token creation block (around lines 358-371):

Replace:
```typescript
        let token: string | null = null;
        if (appUrl) {
          const tokenStr = crypto.randomBytes(32).toString("hex");
          // NOTE: Password reset tokens are stored in plaintext — this is pre-existing
          // tech debt affecting the entire password reset system, not just LDAP.
          // Tracked separately from this PR.
          await tx.passwordReset.create({
            data: {
              userId: user.id,
              token: tokenStr,
              expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
            },
          });
          token = tokenStr;
        }
```

With:
```typescript
        let token: string | null = null;
        if (appUrl) {
          const tokenStr = crypto.randomBytes(32).toString("hex");
          await tx.passwordReset.create({
            data: {
              userId: user.id,
              token: hashToken(tokenStr),
              expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
            },
          });
          token = tokenStr;
        }
```

Key points:
- The plaintext `tokenStr` is kept in memory and passed to `buildResetPasswordUrl` for the welcome email URL (correct — user needs the raw token).
- Only the hash goes to the DB.
- The tech debt comment is removed since the debt is being fixed.

- [ ] **Step 2: Update LDAP sync service tests**

In `apps/server/src/modules/ldap/__tests__/sync.service.test.ts`:

1. Add a mock for `token-hash.ts`. Find the mock section and add:

```typescript
vi.mock("../../../utils/token-hash.js", () => ({
  hashToken: vi.fn((token: string) => `hashed-${token}`),
}));
```

2. Find any assertion that checks `mockPrisma.passwordReset.create` arguments and update to expect the hashed token instead of the raw token. If the test checks `token: expect.any(String)`, it will still pass. If it checks a specific value, update accordingly.

- [ ] **Step 3: Run the LDAP test suite**

Run: `pnpm --filter server test -- src/modules/ldap/__tests__/`
Expected: All tests PASS.

- [ ] **Step 4: Run the full server test suite**

Run: `pnpm --filter server test`
Expected: All tests PASS — confirm no regressions.

- [ ] **Step 5: Run server type-check**

Run: `pnpm --filter server run type-check`
Expected: No type errors.

- [ ] **Step 6: Commit**

```
git add apps/server/src/modules/ldap/sync.service.ts apps/server/src/modules/ldap/__tests__/sync.service.test.ts
git commit -m "feat(server): hash LDAP password reset tokens + remove plaintext comment (TD-39)"
```

---

## Task 4: TD-34 — Add `notifyOnUpload` to Prisma schema + DTOs + service

**Files:**
- Modify: `apps/server/prisma/schema.prisma` (ReverseShare model, around line 336)
- Modify: `apps/server/src/modules/reverse-share/dto.ts`
- Modify: `apps/server/src/modules/reverse-share/service.ts`

- [ ] **Step 1: Add field to Prisma schema**

In `apps/server/prisma/schema.prisma`, in the `ReverseShare` model (around line 336), add `notifyOnUpload` after `emailFieldRequired`:

Replace:
```prisma
  emailFieldRequired FieldRequirement @default(OPTIONAL)
  notifiedForExpiring  Boolean          @default(false)
```

With:
```prisma
  emailFieldRequired FieldRequirement @default(OPTIONAL)
  notifyOnUpload     Boolean          @default(false)
  notifiedForExpiring  Boolean          @default(false)
```

- [ ] **Step 2: Regenerate Prisma client**

Run: `pnpm --filter server exec prisma generate`
Expected: Success.

- [ ] **Step 3: Add `notifyOnUpload` to DTOs**

In `apps/server/src/modules/reverse-share/dto.ts`:

1. In `CreateReverseShareSchema` (after `emailFieldRequired`, around line 43-45), add:

```typescript
  notifyOnUpload: z
    .boolean()
    .default(false)
    .describe("Notify on each file upload, overriding global preference"),
```

2. In `UpdateReverseShareSchema` (after `emailFieldRequired`, around line 65), add:

```typescript
  notifyOnUpload: z.boolean().optional().describe("Notify on each file upload"),
```

3. In `ReverseShareResponseSchema` (after `emailFieldRequired`, around line 94), add:

```typescript
  notifyOnUpload: z.boolean().describe("Whether to notify on each file upload"),
```

- [ ] **Step 4: Add `notifyOnUpload` to service interface and formatter**

In `apps/server/src/modules/reverse-share/service.ts`:

1. Add to the `ReverseShareData` interface (after `emailFieldRequired: string;`, around line 27):

```typescript
  notifyOnUpload: boolean;
```

2. Add to the `formatReverseShareResponse` return object (after `emailFieldRequired`, around line 489):

```typescript
      notifyOnUpload: reverseShare.notifyOnUpload,
```

- [ ] **Step 5: Run server type-check**

Run: `pnpm --filter server run type-check`
Expected: No type errors.

- [ ] **Step 6: Commit**

```
git add apps/server/prisma/schema.prisma apps/server/src/modules/reverse-share/dto.ts apps/server/src/modules/reverse-share/service.ts
git commit -m "feat(server): add notifyOnUpload field to ReverseShare model + DTOs (TD-34)"
```

---

## Task 5: TD-34 — Add `resolveFrequency` branch for `reverse_share_uploaded` + tests

**Files:**
- Modify: `apps/server/src/modules/email/service.ts` (lines 382-396)
- Modify: `apps/server/src/modules/email/__tests__/email-service.test.ts`

- [ ] **Step 1: Write the failing tests**

In `apps/server/src/modules/email/__tests__/email-service.test.ts`:

First, add `reverseShare` to the `mockPrisma` object at the top (around line 26-28). Add after the `share` mock:

```typescript
    reverseShare: {
      findUnique: vi.fn(),
    },
```

Then add these tests inside the `describe("resolveFrequency()")` block, after the last existing test (around line 905):

```typescript
    // ── reverse_share_uploaded + notifyOnUpload ─────────────────────────────

    it("notifyOnUpload=true upgrades reverse_share_uploaded to immediate with overridden", async () => {
      // User has daily_digest preference for reverse_share_uploaded
      mockPrisma.notificationPreference.findUnique.mockResolvedValue({
        id: "pref-1",
        userId: "user-1",
        type: "reverse_share_uploaded",
        frequency: "daily_digest",
      });

      mockPrisma.reverseShare.findUnique.mockResolvedValue({ notifyOnUpload: true });

      const result = await emailService.resolveFrequency("reverse_share_uploaded", "user-1", "rs-1");
      expect(result.frequency).toBe("immediate");
      expect(result.overridden).toBe(true);
    });

    it("notifyOnUpload=false does not override reverse_share_uploaded preference", async () => {
      mockPrisma.notificationPreference.findUnique.mockResolvedValue({
        id: "pref-1",
        userId: "user-1",
        type: "reverse_share_uploaded",
        frequency: "daily_digest",
      });

      mockPrisma.reverseShare.findUnique.mockResolvedValue({ notifyOnUpload: false });

      const result = await emailService.resolveFrequency("reverse_share_uploaded", "user-1", "rs-1");
      expect(result.frequency).toBe("daily_digest");
      expect(result.overridden).toBe(false);
    });

    it("explicit disabled wins over notifyOnUpload=true", async () => {
      mockPrisma.notificationPreference.findUnique.mockResolvedValue({
        id: "pref-1",
        userId: "user-1",
        type: "reverse_share_uploaded",
        frequency: "disabled",
      });

      mockPrisma.reverseShare.findUnique.mockResolvedValue({ notifyOnUpload: true });

      const result = await emailService.resolveFrequency("reverse_share_uploaded", "user-1", "rs-1");
      expect(result.frequency).toBe("disabled");
      expect(result.overridden).toBe(false);
    });

    it("no preference + notifyOnUpload=true → immediate (overrides catalog default)", async () => {
      // No user preference — catalog default for reverse_share_uploaded is "immediate"
      mockPrisma.notificationPreference.findUnique.mockResolvedValue(null);
      mockPrisma.reverseShare.findUnique.mockResolvedValue({ notifyOnUpload: true });

      const result = await emailService.resolveFrequency("reverse_share_uploaded", "user-1", "rs-1");
      expect(result.frequency).toBe("immediate");
      expect(result.overridden).toBe(true);
    });

    it("notifyOnUpload=true does not affect share_downloaded (scoped to uploads only)", async () => {
      mockPrisma.notificationPreference.findUnique.mockResolvedValue(null);
      // Even if reverseShare has notifyOnUpload=true, it shouldn't affect share_downloaded
      mockPrisma.reverseShare.findUnique.mockResolvedValue({ notifyOnUpload: true });
      // share_downloaded catalog default is "disabled"
      mockPrisma.share.findUnique.mockResolvedValue({ notifyOnDownload: false });

      const result = await emailService.resolveFrequency("share_downloaded", "user-1", "rs-1");
      expect(result.frequency).toBe("disabled");
      expect(result.overridden).toBe(false);
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter server test -- src/modules/email/__tests__/email-service.test.ts`
Expected: New tests FAIL — `notifyOnUpload` upgrade branch not implemented yet.

- [ ] **Step 3: Implement the `resolveFrequency` branch**

In `apps/server/src/modules/email/service.ts`, replace the Step 3 comment block and the `share_downloaded` branch (lines 382-396):

Replace:
```typescript
    // Step 3: Per-share notifyOnDownload upgrade (only for share_downloaded).
    // The spec scopes notifyOnDownload to downloads only — share_accessed is not upgraded.
    // Checked BEFORE the catalog default so that users who never set a preference
    // can still get notified when the per-share toggle is on.
    // Known gap: reverse_share_uploaded has a cooldown but no per-share override mechanism
    // analogous to notifyOnDownload. If needed, add a similar toggle on the ReverseShare model.
    if (shareId && type === "share_downloaded") {
      const share = await prisma.share.findUnique({
        where: { id: shareId },
        select: { notifyOnDownload: true },
      });
      if (share?.notifyOnDownload) {
        return { frequency: "immediate", overridden: true };
      }
    }
```

With:
```typescript
    // Step 3: Per-share/reverse-share notification overrides.
    // Checked BEFORE the catalog default so that users who never set a preference
    // can still get notified when the per-share toggle is on.
    if (shareId) {
      // Step 3a: notifyOnDownload (only for share_downloaded — not share_accessed)
      if (type === "share_downloaded") {
        const share = await prisma.share.findUnique({
          where: { id: shareId },
          select: { notifyOnDownload: true },
        });
        if (share?.notifyOnDownload) {
          return { frequency: "immediate", overridden: true };
        }
      }

      // Step 3b: notifyOnUpload (only for reverse_share_uploaded)
      if (type === "reverse_share_uploaded") {
        const reverseShare = await prisma.reverseShare.findUnique({
          where: { id: shareId },
          select: { notifyOnUpload: true },
        });
        if (reverseShare?.notifyOnUpload) {
          return { frequency: "immediate", overridden: true };
        }
      }
    }
```

Also update the JSDoc comment above the method (around line 355) to mention the new Step 3b:

Replace:
```typescript
   * 3. Per-share override: if share.notifyOnDownload=true → upgrade to "immediate"
```

With:
```typescript
   * 3a. Per-share override: if share.notifyOnDownload=true → upgrade to "immediate"
   * 3b. Per-reverse-share override: if reverseShare.notifyOnUpload=true → upgrade to "immediate"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter server test -- src/modules/email/__tests__/email-service.test.ts`
Expected: All tests PASS (existing + new).

- [ ] **Step 5: Commit**

```
git add apps/server/src/modules/email/service.ts apps/server/src/modules/email/__tests__/email-service.test.ts
git commit -m "feat(server): add resolveFrequency branch for notifyOnUpload per-reverse-share (TD-34)"
```

---

## Task 6: TD-34 — Add `notifyOnUpload` to frontend types + form + create modal

**Files:**
- Modify: `apps/web/src/http/endpoints/reverse-shares/types.ts`
- Modify: `apps/web/src/app/(shares)/reverse-shares/components/create-reverse-share/types.ts`
- Modify: `apps/web/src/app/(shares)/reverse-shares/components/create-reverse-share-modal.tsx`

- [ ] **Step 1: Add `notifyOnUpload` to HTTP types**

In `apps/web/src/http/endpoints/reverse-shares/types.ts`:

1. In `BaseReverseShare` (after `emailFieldRequired: string;`, around line 39), add:

```typescript
  notifyOnUpload: boolean;
```

2. In `CreateReverseShareBody` (after `emailFieldRequired?: FieldRequirement;`, around line 115), add:

```typescript
  notifyOnUpload?: boolean;
```

3. In `UpdateReverseShareBody` (after `emailFieldRequired?: FieldRequirement;`, around line 131), add:

```typescript
  notifyOnUpload?: boolean;
```

- [ ] **Step 2: Add `notifyOnUpload` to form types**

In `apps/web/src/app/(shares)/reverse-shares/components/create-reverse-share/types.ts`:

1. Add to `CreateReverseShareFormData` interface (after `allFileTypes: boolean;`, around line 19):

```typescript
  notifyOnUpload: boolean;
```

2. Add to `DEFAULT_FORM_VALUES` (after `allFileTypes: true,`, around line 40):

```typescript
  notifyOnUpload: false,
```

- [ ] **Step 3: Add `notifyOnUpload` toggle to create modal**

In `apps/web/src/app/(shares)/reverse-shares/components/create-reverse-share-modal.tsx`:

1. Add imports for `Switch` and `Label` at top:

```typescript
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
```

2. Add `useId` import from React:

```typescript
import { useId } from "react";
```

3. In the `buildPayload` function (around line 39-78), add `notifyOnUpload` to the payload object after `emailFieldRequired`:

```typescript
    notifyOnUpload: formData.notifyOnUpload,
```

4. Inside the component function (after the `watchedValues` block), add an id for the switch:

```typescript
  const notifyUploadSwitchId = useId();
```

5. Add the notification toggle section in the form, after the `FieldRequirementsSection` and before the `DialogFooter` (around line 153-154). Add it between the last `Separator` and `DialogFooter`:

```tsx
              <Separator />
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={form.watch("notifyOnUpload")}
                    onCheckedChange={(checked) => form.setValue("notifyOnUpload", checked)}
                    id={notifyUploadSwitchId}
                  />
                  <Label htmlFor={notifyUploadSwitchId}>
                    {t("reverseShares.form.notifyOnUpload")}
                  </Label>
                </div>
                <p className="text-xs text-muted-foreground ps-9">
                  {t("reverseShares.form.notifyOnUploadHelp")}
                </p>
              </div>
```

- [ ] **Step 4: Run frontend type-check**

Run: `pnpm --filter web run type-check`
Expected: Type errors for missing i18n keys (expected — will be added in Task 8). Other than i18n, no type errors.

- [ ] **Step 5: Commit**

```
git add apps/web/src/http/endpoints/reverse-shares/types.ts apps/web/src/app/(shares)/reverse-shares/components/create-reverse-share/types.ts apps/web/src/app/(shares)/reverse-shares/components/create-reverse-share-modal.tsx
git commit -m "feat(web): add notifyOnUpload to reverse share create form (TD-34)"
```

---

## Task 7: TD-34 — Add `notifyOnUpload` toggle to reverse share details modal

**Files:**
- Modify: `apps/web/src/app/(shares)/reverse-shares/components/reverse-share-details-modal.tsx`

- [ ] **Step 1: Widen `handleUpdateField` to accept booleans**

In `apps/web/src/app/(shares)/reverse-shares/components/reverse-share-details-modal.tsx`:

The current signature at line 94 is:
```typescript
  const handleUpdateField = async (field: string, value: string | number | null) => {
```

Widen it to also accept `boolean`:
```typescript
  const handleUpdateField = async (field: string, value: string | number | boolean | null) => {
```

- [ ] **Step 2: Add `Switch` import and notification toggle UI**

1. Add `Switch` import at the top (check if already imported — if not, add):
```typescript
import { Switch } from "@/components/ui/switch";
```

2. In the "Security & Status" section (around line 488, after the status active/inactive toggle and before the expiration `EditableField`), add the notification toggle:

```tsx
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">
                    {t("reverseShares.form.notifyOnUpload")}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <Switch
                      checked={
                        pendingChanges.notifyOnUpload !== undefined
                          ? (pendingChanges.notifyOnUpload as boolean)
                          : reverseShare.notifyOnUpload
                      }
                      onCheckedChange={(checked) =>
                        handleUpdateField("notifyOnUpload", checked)
                      }
                      disabled={!onUpdateReverseShare}
                    />
                    <span className="text-sm text-muted-foreground">
                      {t("reverseShares.form.notifyOnUploadHelp")}
                    </span>
                  </div>
                </div>
```

- [ ] **Step 3: Run frontend type-check**

Run: `pnpm --filter web run type-check`
Expected: Possible i18n key warnings (will be fixed in Task 8). No other type errors.

- [ ] **Step 4: Commit**

```
git add apps/web/src/app/(shares)/reverse-shares/components/reverse-share-details-modal.tsx
git commit -m "feat(web): add notifyOnUpload toggle to reverse share details modal (TD-34)"
```

---

## Task 8: TD-34 — Add i18n keys to all 23 locale files

**Files:**
- Modify: `apps/web/messages/*.json` (23 files)

- [ ] **Step 1: Add keys to en-US.json (source of truth)**

In `apps/web/messages/en-US.json`, inside the `reverseShares.form` object (around line 1533, before `"submit"`), add:

```json
      "notifyOnUpload": "Notify me on each upload",
      "notifyOnUploadHelp": "When enabled, you'll receive email notifications when files are uploaded to this receive link, regardless of your global notification preferences.",
```

- [ ] **Step 2: Add the same keys to all 22 other locale files**

For each non-English locale file, add the same English keys inside the `reverseShares.form` object (same location as en-US). The keys use English text as fallback (this is the established pattern — see TD-36 which tracks untranslated strings separately).

The 22 files to update:
`ar-SA.json`, `de-DE.json`, `el-GR.json`, `es-ES.json`, `fa-IR.json`, `fr-FR.json`, `he-IL.json`, `hi-IN.json`, `id-ID.json`, `it-IT.json`, `ja-JP.json`, `ko-KR.json`, `nl-NL.json`, `pl-PL.json`, `pt-BR.json`, `ru-RU.json`, `sv-SE.json`, `th-TH.json`, `tr-TR.json`, `uk-UA.json`, `vi-VN.json`, `zh-CN.json`

For `fr-FR.json`, use proper French translations:
```json
      "notifyOnUpload": "Me notifier à chaque envoi de fichier",
      "notifyOnUploadHelp": "Lorsque activé, vous recevrez des notifications par email quand des fichiers sont envoyés vers ce lien de réception, indépendamment de vos préférences de notification globales.",
```

All other locales use English text (consistent with existing pattern).

- [ ] **Step 3: Run frontend type-check**

Run: `pnpm --filter web run type-check`
Expected: No type errors.

- [ ] **Step 4: Commit**

```
git add apps/web/messages/
git commit -m "feat(i18n): add notifyOnUpload translation keys to all 23 locales (TD-34)"
```

---

## Task 9: TD-34 — Recreate SQLite database with new schema

**Files:** None (operational step)

- [ ] **Step 1: Recreate the dev database**

Since there's no production data and no backward compatibility requirement, recreate the SQLite database with the updated schema:

Run: `just db-dev-init`
Or if `just` is not available: `pnpm --filter server exec prisma db push --force-reset`

Expected: Database recreated with `notifyOnUpload` column in `reverse_shares` table.

- [ ] **Step 2: Seed the database (if applicable)**

Run: `just db-seed` (if seeds exist and are needed for development)

- [ ] **Step 3: No commit needed** (database is gitignored)

---

## Task 10: Final verification

- [ ] **Step 1: Run the full server test suite**

Run: `pnpm --filter server test`
Expected: All tests PASS (including new `hashToken`, `resolveFrequency`, and existing tests).

- [ ] **Step 2: Run full server type-check**

Run: `pnpm --filter server run type-check`
Expected: No errors.

- [ ] **Step 3: Run full frontend type-check**

Run: `pnpm --filter web run type-check`
Expected: No errors.

- [ ] **Step 4: Update TECHNICAL-DEBT.md**

Mark TD-34 and TD-39 as DONE in `features/TECHNICAL-DEBT.md`.

- [ ] **Step 5: Commit the status update**

```
git add features/TECHNICAL-DEBT.md
git commit -m "docs: mark TD-34 and TD-39 as resolved"
```
