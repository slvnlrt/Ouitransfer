# Batch 3: i18n Loader + Base Layout

> **Depends on:** Batch 1 (Prisma schema — no direct dependency, but foundation required), Batch 2 (SmtpTransport complete)
> **Required by:** Batch 4 (EmailService uses i18n loader), Batch 6 (templates use base layout and i18n)

**Goal:** Build the server-side i18n system and the HTML/text base layout for all email templates.

**Files:**
- Create: `apps/server/src/modules/email/i18n/loader.ts`
- Create: `apps/server/src/modules/email/i18n/messages/en.json` (skeleton — common keys only)
- Create: `apps/server/src/modules/email/i18n/messages/fr.json` (skeleton)
- Create: `apps/server/src/modules/email/templates/base-layout.ts`
- Create: `apps/server/src/modules/email/__tests__/i18n-loader.test.ts`
- Create: `apps/server/src/modules/email/__tests__/base-layout.test.ts`

**Reference:** Spec Section 3.

### Steps

- [ ] **Step 1: Write i18n loader tests**

```typescript
describe("i18n loader", () => {
  it("t('en', 'common.footer', { appName: 'Test' }) interpolates correctly");
  it("t('fr', 'common.footer', ...) returns French text");
  it("t('de', ...) falls back to en when de.json lacks the key");
  it("t('en', 'nonexistent.key') throws Error (missing in en = bug)");
  it("handles nested paths ('shareInvitation.subject')");
  it("returns raw template when no params provided");
  it("createTranslationFn(locale) returns a curried function");
  it("validateI18nKeys([...]) passes when all keys exist in en.json");
  it("validateI18nKeys([...]) throws when any key is missing");
  it("caches loaded locale files (second call doesn't re-read)");
});
```

- [ ] **Step 2: Implement i18n loader**

```typescript
// i18n/loader.ts
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const messagesDir = path.join(__dirname, "messages");
const cache = new Map<string, Record<string, unknown>>();

export type TranslationFn = (path: string, params?: Record<string, string>) => string;

export function t(locale: string, dotPath: string, params?: Record<string, string>): string {
  // 1. Try requested locale
  // 2. Fall back to "en"
  // 3. Throw if missing in en (bug)
  // Interpolation: replace {key} with params[key]
}

export function createTranslationFn(locale: string): TranslationFn {
  return (path, params) => t(locale, path, params);
}

export function validateI18nKeys(requiredKeys: string[]): void {
  // Load en.json, check each key exists, throw with list of missing
}

// Internal: loadLocale, resolvePath, interpolate (see spec Section 3 for details)
```

- [ ] **Step 3: Create en.json skeleton**

Start with `common` keys only (template-specific keys added in Batch 6):

```json
{
  "common": {
    "footer": "This email was sent by <strong>{appName}</strong>",
    "footerIgnore": "If you didn't expect this email, you can safely ignore it.",
    "poweredBy": "Powered by Ouitransfer",
    "unsubscribe": "Unsubscribe from these notifications"
  }
}
```

`fr.json` with proper French translations for the same keys.

- [ ] **Step 4: Run i18n tests**

```bash
pnpm --filter @ouitransfer/server test -- --run src/modules/email/__tests__/i18n-loader.test.ts
```

- [ ] **Step 5: Write base layout tests**

```typescript
describe("renderLayout", () => {
  it("renders HTML with indigo header containing appName and subtitle");
  it("renders body content in the HTML body section");
  it("renders CTA button when cta slot is provided");
  it("renders info box when infoBox slot is provided");
  it("renders unsubscribe link in footer when unsubscribeUrl is provided");
  it("omits unsubscribe link when unsubscribeUrl is absent");
  it("generates plain text version with no HTML tags");
  it("plain text includes CTA as 'Label: URL' format");
  it("plain text strips HTML formatting from body");
  it("uses inline styles for Outlook compatibility (no <style> blocks)");
  it("max-width is 600px for responsive email");
});
```

- [ ] **Step 6: Implement base layout**

Create `templates/base-layout.ts`. Follow spec Section 3 visual design:

```typescript
export interface LayoutSlots {
  subtitle: string;
  body: string;
  cta?: { url: string; label: string };
  infoBox?: string;
  unsubscribeUrl?: string;
}

export interface LayoutConfig {
  appName: string;
}

export function renderLayout(slots: LayoutSlots, config: LayoutConfig): { html: string; text: string } {
  return {
    html: renderHtml(slots, config),
    text: renderText(slots, config),
  };
}
```

The `renderHtml()` function produces a complete HTML email with:
- Indigo (#6366f1) header bar with `config.appName` + `slots.subtitle`
- White body with system font stack, max 600px centered
- Indigo CTA button if `slots.cta` is provided
- Info box with left indigo border if `slots.infoBox` is provided
- Footer: "This email was sent by {appName}" + "Powered by Ouitransfer"
- Unsubscribe text + link in footer if `slots.unsubscribeUrl` is provided
- ALL styles must be inline (no `<style>` block — Outlook strips them)

The `renderText()` function strips HTML and formats for plain text.

Also move `escapeHtml()` utility from old `email/service.ts` (lines 9-16) to a shared utility file (e.g., `apps/server/src/utils/escape-html.ts`). It's used by the base layout for sanitizing user-provided content in emails.

- [ ] **Step 7: Run base layout tests**

```bash
pnpm --filter @ouitransfer/server test -- --run src/modules/email/__tests__/base-layout.test.ts
```

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/modules/email/i18n/ apps/server/src/modules/email/templates/base-layout.ts apps/server/src/modules/email/__tests__/
git commit -m "feat(email): add i18n loader with fallback chain and base email layout"
```
