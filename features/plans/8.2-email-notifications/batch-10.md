# Batch 10: Notification Preferences + Unsubscribe

> **Depends on:** Batch 4 (notificationCatalog — preference service validates types against it), Batch 1 (NotificationPreference model in Prisma)
> **Required by:** Batch 11 (admin email endpoints add to the same notification routes file), Batch 12 (frontend calls these endpoints)

**Goal:** Build user notification preferences CRUD, the preference cascade integration, and the two-step unsubscribe mechanism.

**Files:**
- Create: `apps/server/src/modules/notification/routes.ts`
- Create: `apps/server/src/modules/notification/service.ts`
- Create: `apps/server/src/modules/notification/__tests__/routes.test.ts`
- Modify: `apps/server/src/server.ts`

**Reference:** Spec Sections 6 (preferences, unsubscribe) and 9 (endpoints).

### Steps

- [ ] **Step 1: Implement notification service**

```typescript
// notification/service.ts

import { prisma } from "../../shared/prisma.js";
import { notificationCatalog, type NotificationKey } from "../email/catalog.js";
import { env } from "../../env.js";
import * as crypto from "node:crypto";
import jwt from "jsonwebtoken";

export interface PreferenceResponse {
  type: string;
  label: string;
  frequency: string;
  configurable: boolean;
  isCritical: boolean;
}

export async function getUserPreferences(userId: string): Promise<PreferenceResponse[]> {
  // 1. Get all NotificationPreference rows for this user
  // 2. For each type in notificationCatalog where configurable=true:
  //    - Return stored frequency if exists, else catalog defaultFrequency
  // 3. Also include non-configurable types (marked as isCritical) for display
}

export async function updateUserPreferences(
  userId: string,
  preferences: { type: string; frequency: string }[],
): Promise<void> {
  for (const pref of preferences) {
    // Validate type exists in catalog and is configurable
    const entry = notificationCatalog[pref.type as NotificationKey];
    if (!entry || !entry.configurable) {
      throw new ValidationError(`Invalid or non-configurable notification type: ${pref.type}`);
    }
    // Upsert
    await prisma.notificationPreference.upsert({
      where: { userId_type: { userId, type: pref.type } },
      update: { frequency: pref.frequency },
      create: { userId, type: pref.type, frequency: pref.frequency },
    });
  }
}

export function getUnsubscribeSecret(): Buffer {
  return crypto.createHmac("sha256", env.JWT_SECRET).update("unsubscribe").digest();
}

export function verifyUnsubscribeToken(token: string): { userId: string; type: string } {
  return jwt.verify(token, getUnsubscribeSecret()) as { userId: string; type: string };
}

export async function unsubscribeUser(userId: string, type: string): Promise<void> {
  await prisma.notificationPreference.upsert({
    where: { userId_type: { userId, type } },
    update: { frequency: "disabled" },
    create: { userId, type, frequency: "disabled" },
  });
}
```

- [ ] **Step 2: Implement notification routes**

```typescript
// notification/routes.ts
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { getUserPreferences, updateUserPreferences, verifyUnsubscribeToken, unsubscribeUser } from "./service.js";

export async function notificationRoutes(app: FastifyInstance) {
  // GET /notifications/preferences — authenticated
  app.get("/notifications/preferences", {
    preHandler: [requireAuth],
  }, async (request) => {
    return getUserPreferences(request.user.id);
  });

  // PUT /notifications/preferences — authenticated
  app.put("/notifications/preferences", {
    preHandler: [requireAuth],
    schema: {
      body: z.object({
        preferences: z.array(z.object({
          type: z.string(),
          frequency: z.enum(["immediate", "disabled"]), // Restricted until digest ships
        })),
      }),
    },
  }, async (request) => {
    await updateUserPreferences(request.user.id, request.body.preferences);
    return { success: true };
  });

  // GET /notifications/unsubscribe — renders confirmation page (NO action!)
  app.get("/notifications/unsubscribe", async (request, reply) => {
    const token = (request.query as { token?: string }).token;
    if (!token) return reply.code(400).send({ error: "Token required" });
    try {
      const { type } = verifyUnsubscribeToken(token);
      // Render simple HTML confirmation page with POST form
      reply.type("text/html").send(renderUnsubscribeConfirmationPage(type, token));
    } catch {
      reply.type("text/html").send(renderUnsubscribeErrorPage());
    }
  });

  // POST /notifications/unsubscribe — performs the actual unsubscribe
  app.post("/notifications/unsubscribe", {
    config: { csrfProtection: false }, // Public endpoint with signed token
    schema: {
      body: z.object({ token: z.string() }),
    },
  }, async (request, reply) => {
    try {
      const { userId, type } = verifyUnsubscribeToken(request.body.token);
      await unsubscribeUser(userId, type);
      reply.type("text/html").send(renderUnsubscribeSuccessPage(type));
    } catch {
      reply.type("text/html").send(renderUnsubscribeErrorPage());
    }
  });
}

// Helper functions to render simple HTML pages (no template engine needed — just string concatenation)
function renderUnsubscribeConfirmationPage(type: string, token: string): string { /* ... */ }
function renderUnsubscribeSuccessPage(type: string): string { /* ... */ }
function renderUnsubscribeErrorPage(): string { /* ... */ }
```

- [ ] **Step 3: Register routes in server.ts**

```typescript
import { notificationRoutes } from "./modules/notification/routes.js";
app.register(notificationRoutes);
```

- [ ] **Step 4: Write integration tests**

```typescript
describe("notification preferences", () => {
  it("GET /notifications/preferences returns all configurable types with defaults");
  it("PUT /notifications/preferences updates frequency for a configurable type");
  it("PUT /notifications/preferences with non-configurable type → 400");
  it("PUT /notifications/preferences with 'daily_digest' → 400 (not yet supported)");
  it("unauthenticated → 401");
});

describe("unsubscribe", () => {
  it("GET /notifications/unsubscribe with valid token → HTML confirmation page (does NOT unsubscribe)");
  it("POST /notifications/unsubscribe with valid token → preference set to disabled");
  it("POST /notifications/unsubscribe with expired token → error page");
  it("POST /notifications/unsubscribe with invalid token → error page");
  it("GET /notifications/unsubscribe without token → 400");
  it("re-unsubscribing is idempotent");
});
```

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @ouitransfer/server test
```

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/modules/notification/ apps/server/src/server.ts
git commit -m "feat(email): add notification preferences CRUD and stateless unsubscribe mechanism"
```
