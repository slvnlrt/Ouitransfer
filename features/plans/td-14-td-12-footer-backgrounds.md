# TD-14 / TD-12 — Footer Configurable + Background Images — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the footer configurable (TD-14) and replace hardcoded background images with an admin-managed S3 gallery with user selection (TD-12).

**Architecture:** Two independent features sharing a single DB migration. TD-14 adds 3 AppConfig rows and updates footers to read them. TD-12 adds a new `BackgroundImage` Prisma model, a server module with 6 endpoints, an admin image manager in settings, an image picker in the reverse share form, and dynamic background loading in the WeTransfer layout.

**Tech Stack:** Prisma (SQLite), Fastify 5 + Zod, sharp, @aws-sdk/client-s3, Next.js 15, React 19, TanStack Query, shadcn/ui, next-intl

---

## File Structure

### TD-14 (Footer configurable)

| Action | File | Purpose |
|--------|------|---------|
| Modify | `apps/server/prisma/schema.prisma` | No model change (AppConfig already exists) |
| Modify | `apps/server/prisma/seed.js` | Add 3 new AppConfig rows |
| Modify | `apps/web/src/components/ui/default-footer.tsx` | Read footer config from public configs |
| Modify | `apps/web/src/app/(shares)/r/[alias]/components/transparent-footer.tsx` | Same |
| Modify | `apps/web/src/app/settings/constants.ts` | Add footer field descriptions |
| Modify | `apps/web/messages/en-US.json` (+ 22 other locales) | Add settings.fields.footer*.title/description |

### TD-12 (Background Images)

| Action | File | Purpose |
|--------|------|---------|
| Modify | `apps/server/prisma/schema.prisma` | Add `BackgroundImage` model + FK on `ReverseShare` |
| Create | `apps/server/src/modules/background-image/dto.ts` | Zod schemas |
| Create | `apps/server/src/modules/background-image/repository.ts` | Prisma queries |
| Create | `apps/server/src/modules/background-image/service.ts` | Upload processing, S3 ops, CRUD |
| Create | `apps/server/src/modules/background-image/routes.ts` | 6 Fastify routes |
| Modify | `apps/server/src/server.ts` | Register backgroundImageRoutes |
| Modify | `apps/server/src/modules/reverse-share/dto.ts` | Add `backgroundImageId` to schemas |
| Modify | `apps/server/src/modules/reverse-share/repository.ts` | Include `backgroundImage` in queries |
| Modify | `apps/server/src/modules/reverse-share/service.ts` | Add `backgroundImageId` to response type |
| Modify | `packages/shared/src/error-codes.ts` | Add BACKGROUND_IMAGE_NOT_FOUND |
| Modify | `apps/web/src/lib/proxy-routes.ts` | Add background-images proxy routes |
| Create | `apps/web/src/http/endpoints/background-images/index.ts` | HTTP client functions |
| Create | `apps/web/src/http/endpoints/background-images/types.ts` | Response types |
| Modify | `apps/web/src/http/endpoints/index.ts` | Re-export background-images |
| Modify | `apps/web/src/lib/query-keys.ts` | Add backgroundImages keys |
| Create | `apps/web/src/app/settings/components/background-image-manager.tsx` | Admin image manager component |
| Modify | `apps/web/src/app/settings/components/settings-form.tsx` | Add `backgrounds` group special case |
| Modify | `apps/web/src/app/settings/constants.ts` | Add `backgrounds` group metadata |
| Modify | `apps/web/src/app/(shares)/reverse-shares/components/create-reverse-share/types.ts` | Add `backgroundImageId` field |
| Create | `apps/web/src/app/(shares)/reverse-shares/components/create-reverse-share/background-image-section.tsx` | Image picker section |
| Modify | `apps/web/src/app/(shares)/reverse-shares/components/create-reverse-share/basic-info-section.tsx` | Show image picker when WETRANSFER selected |
| Modify | `apps/web/src/app/(shares)/r/[alias]/components/we-transfer-layout.tsx` | Dynamic background from S3 / gradient fallback |
| Modify | `apps/web/src/app/(shares)/r/[alias]/constants/index.ts` | Remove `BACKGROUND_IMAGES` array |
| Delete | `apps/web/public/assets/wetransfer-bgs/*.jpg` | Delete 8 hardcoded images |
| Modify | `apps/web/messages/en-US.json` (+ 22 locales) | Add backgroundImages.* and reverseShares.form.backgroundImage.* keys |

### Tests

| Action | File | Purpose |
|--------|------|---------|
| Create | `apps/server/src/modules/background-image/__tests__/service.test.ts` | Unit tests for upload processing, name derivation |
| Create | `apps/server/src/modules/background-image/__tests__/routes.test.ts` | Integration tests for all 6 endpoints |

---

## Task 1: Prisma Schema + Seed — Footer Config + BackgroundImage Model

**Files:**
- Modify: `apps/server/prisma/schema.prisma`
- Modify: `apps/server/prisma/seed.js`

- [ ] **Step 1: Add BackgroundImage model to Prisma schema**

In `apps/server/prisma/schema.prisma`, add after the `ReverseShareAlias` model (around line 297):

```prisma
model BackgroundImage {
  id             String   @id @default(cuid())
  name           String?
  s3Key          String
  thumbnailS3Key String
  sortOrder      Int      @default(0)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  reverseShares ReverseShare[]

  @@map("background_images")
}
```

- [ ] **Step 2: Add backgroundImageId FK to ReverseShare model**

In `apps/server/prisma/schema.prisma`, in the `ReverseShare` model (line 245), add before `creatorId`:

```prisma
  backgroundImageId  String?
  backgroundImage    BackgroundImage? @relation(fields: [backgroundImageId], references: [id], onDelete: SetNull)
```

- [ ] **Step 3: Add 3 footer config rows to seed**

In `apps/server/prisma/seed.js`, add to the `defaultConfigs` array (after the existing general configs, around line 37):

```js
  {
    key: "footerEnabled",
    value: "true",
    type: "boolean",
    group: "general",
  },
  {
    key: "footerText",
    value: "Ouitransfer",
    type: "string",
    group: "general",
  },
  {
    key: "footerUrl",
    value: "https://example.com",
    type: "string",
    group: "general",
  },
```

- [ ] **Step 4: Run prisma generate and db push**

```bash
cd apps/server
npx prisma generate
npx prisma db push --force-reset
npx prisma db seed
```

- [ ] **Step 5: Commit**

```bash
git add apps/server/prisma/schema.prisma apps/server/prisma/seed.js
git commit -m "feat: add BackgroundImage model and footer config seeds"
```

---

## Task 2: Error Codes + Shared Types

**Files:**
- Modify: `packages/shared/src/error-codes.ts`

- [ ] **Step 1: Add BACKGROUND_IMAGE_NOT_FOUND error code**

In `packages/shared/src/error-codes.ts`, add in the Resources section (after `GONE`):

```ts
  BACKGROUND_IMAGE_NOT_FOUND: "BACKGROUND_IMAGE_NOT_FOUND",
```

- [ ] **Step 2: Run type-check**

```bash
pnpm --filter @ouitransfer/shared test
```

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/error-codes.ts
git commit -m "feat: add BACKGROUND_IMAGE_NOT_FOUND error code"
```

---

## Task 3: Server — Background Image Module (dto, repository, service, routes)

**Files:**
- Create: `apps/server/src/modules/background-image/dto.ts`
- Create: `apps/server/src/modules/background-image/repository.ts`
- Create: `apps/server/src/modules/background-image/service.ts`
- Create: `apps/server/src/modules/background-image/routes.ts`
- Modify: `apps/server/src/server.ts`

- [ ] **Step 1: Create dto.ts**

Create `apps/server/src/modules/background-image/dto.ts`:

```ts
import { z } from "zod";

export const BackgroundImageResponseSchema = z.object({
  id: z.string().describe("Image ID"),
  name: z.string().nullable().describe("Display name"),
  s3Key: z.string().describe("S3 object key for full image"),
  thumbnailS3Key: z.string().describe("S3 object key for thumbnail"),
  thumbnailUrl: z.string().describe("Presigned thumbnail URL"),
  sortOrder: z.number().describe("Sort order"),
  createdAt: z.string().describe("Creation date"),
  updatedAt: z.string().describe("Update date"),
});

export const UpdateBackgroundImageSchema = z.object({
  name: z.string().optional().describe("New display name"),
});

export const ReorderBackgroundImagesSchema = z.object({
  ids: z.array(z.string()).min(1).describe("Ordered array of image IDs"),
});

export type BackgroundImageResponse = z.infer<typeof BackgroundImageResponseSchema>;
```

- [ ] **Step 2: Create repository.ts**

Create `apps/server/src/modules/background-image/repository.ts`:

```ts
import { prisma } from "../../shared/prisma.js";

export class BackgroundImageRepository {
  async findAll() {
    return prisma.backgroundImage.findMany({
      orderBy: { sortOrder: "asc" },
    });
  }

  async findById(id: string) {
    return prisma.backgroundImage.findUnique({ where: { id } });
  }

  async create(data: { name: string | null; s3Key: string; thumbnailS3Key: string }) {
    const maxOrder = await prisma.backgroundImage.aggregate({ _max: { sortOrder: true } });
    const nextOrder = (maxOrder._max.sortOrder ?? -1) + 1;

    return prisma.backgroundImage.create({
      data: { ...data, sortOrder: nextOrder },
    });
  }

  async update(id: string, data: { name?: string }) {
    return prisma.backgroundImage.update({
      where: { id },
      data,
    });
  }

  async reorder(ids: string[]) {
    return prisma.$transaction(
      ids.map((id, index) =>
        prisma.backgroundImage.update({
          where: { id },
          data: { sortOrder: index },
        }),
      ),
    );
  }

  async delete(id: string) {
    return prisma.backgroundImage.delete({ where: { id } });
  }
}
```

- [ ] **Step 3: Create service.ts**

Create `apps/server/src/modules/background-image/service.ts`:

```ts
import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";

import { bucketName, s3Client } from "../../config/storage.config.js";
import { NotFoundError, ValidationError } from "../../utils/app-error.js";
import { getLogger } from "../../utils/logger.js";
import type { BackgroundImageResponse } from "./dto.js";
import { BackgroundImageRepository } from "./repository.js";

const FULL_WIDTH = 1920;
const THUMB_WIDTH = 400;
const FULL_QUALITY = 80;
const THUMB_QUALITY = 70;
const MAX_RAW_SIZE = 10 * 1024 * 1024; // 10 MB
const PRESIGNED_EXPIRY = 3600; // 1 hour

export class BackgroundImageService {
  private repository = new BackgroundImageRepository();

  async listAll(): Promise<BackgroundImageResponse[]> {
    const images = await this.repository.findAll();
    const responses: BackgroundImageResponse[] = [];

    for (const img of images) {
      const thumbnailUrl = await this.getPresignedUrl(img.thumbnailS3Key);
      responses.push({
        id: img.id,
        name: img.name,
        s3Key: img.s3Key,
        thumbnailS3Key: img.thumbnailS3Key,
        thumbnailUrl,
        sortOrder: img.sortOrder,
        createdAt: img.createdAt.toISOString(),
        updatedAt: img.updatedAt.toISOString(),
      });
    }

    return responses;
  }

  async getImageUrl(id: string, type: "full" | "thumb" = "full"): Promise<string> {
    const image = await this.repository.findById(id);
    if (!image) {
      throw new NotFoundError("Background image not found");
    }
    const key = type === "thumb" ? image.thumbnailS3Key : image.s3Key;
    return this.getPresignedUrl(key);
  }

  async upload(buffer: Buffer, originalFilename: string, name?: string): Promise<BackgroundImageResponse> {
    if (buffer.length > MAX_RAW_SIZE) {
      throw new ValidationError(`Image too large. Maximum size is ${MAX_RAW_SIZE / 1024 / 1024}MB.`);
    }

    // Validate that sharp can read this image
    const metadata = await sharp(buffer).metadata();
    if (!metadata.width || !metadata.height) {
      throw new ValidationError("Invalid image file");
    }

    // Generate a temporary ID for S3 keys
    const { createId } = await import("@paralleldrive/cuid2");
    const id = createId();

    // Process images
    const fullBuffer = await sharp(buffer)
      .resize({ width: FULL_WIDTH, withoutEnlargement: true })
      .webp({ quality: FULL_QUALITY })
      .toBuffer();

    const thumbBuffer = await sharp(buffer)
      .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
      .webp({ quality: THUMB_QUALITY })
      .toBuffer();

    const s3Key = `backgrounds/${id}.webp`;
    const thumbnailS3Key = `backgrounds/${id}_thumb.webp`;

    // Upload to S3
    const client = this.ensureS3Client();
    await client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: s3Key,
        Body: fullBuffer,
        ContentType: "image/webp",
      }),
    );

    await client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: thumbnailS3Key,
        Body: thumbBuffer,
        ContentType: "image/webp",
      }),
    );

    // Derive name from filename if not provided
    const derivedName = name || this.deriveNameFromFilename(originalFilename);

    // Create DB record
    const image = await this.repository.create({
      name: derivedName,
      s3Key,
      thumbnailS3Key,
    });

    const thumbnailUrl = await this.getPresignedUrl(thumbnailS3Key);

    return {
      id: image.id,
      name: image.name,
      s3Key: image.s3Key,
      thumbnailS3Key: image.thumbnailS3Key,
      thumbnailUrl,
      sortOrder: image.sortOrder,
      createdAt: image.createdAt.toISOString(),
      updatedAt: image.updatedAt.toISOString(),
    };
  }

  async rename(id: string, name: string): Promise<BackgroundImageResponse> {
    const image = await this.repository.findById(id);
    if (!image) {
      throw new NotFoundError("Background image not found");
    }

    const updated = await this.repository.update(id, { name });
    const thumbnailUrl = await this.getPresignedUrl(updated.thumbnailS3Key);

    return {
      id: updated.id,
      name: updated.name,
      s3Key: updated.s3Key,
      thumbnailS3Key: updated.thumbnailS3Key,
      thumbnailUrl,
      sortOrder: updated.sortOrder,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  async reorder(ids: string[]) {
    await this.repository.reorder(ids);
  }

  async delete(id: string) {
    const image = await this.repository.findById(id);
    if (!image) {
      throw new NotFoundError("Background image not found");
    }

    // Delete S3 objects
    const client = this.ensureS3Client();
    try {
      await client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: image.s3Key }));
      await client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: image.thumbnailS3Key }));
    } catch (err) {
      getLogger().warn({ err, id }, "Failed to delete S3 objects for background image — proceeding with DB deletion");
    }

    // Delete DB record (onDelete: SetNull clears FK on ReverseShares)
    await this.repository.delete(id);
  }

  /** Derive a display name from a filename: strip extension, replace separators, title-case */
  deriveNameFromFilename(filename: string): string {
    const nameWithoutExt = filename.replace(/\.[^.]+$/, "");
    return nameWithoutExt
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim() || "Untitled";
  }

  private ensureS3Client() {
    if (!s3Client) {
      throw new Error("S3 client is not configured");
    }
    return s3Client;
  }

  private async getPresignedUrl(key: string): Promise<string> {
    const client = this.ensureS3Client();
    return getSignedUrl(client, new GetObjectCommand({ Bucket: bucketName, Key: key }), {
      expiresIn: PRESIGNED_EXPIRY,
    });
  }
}
```

- [ ] **Step 4: Create routes.ts**

Create `apps/server/src/modules/background-image/routes.ts`:

```ts
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { createAdminPreValidation } from "../../middleware/admin-prevalidation.js";
import { ValidationError } from "../../utils/app-error.js";
import { ErrorResponseSchema } from "../../utils/error-response-schema.js";
import {
  BackgroundImageResponseSchema,
  ReorderBackgroundImagesSchema,
  UpdateBackgroundImageSchema,
} from "./dto.js";
import { BackgroundImageService } from "./service.js";

const service = new BackgroundImageService();
const adminPreValidation = createAdminPreValidation({ allowSetupBypass: false });

export const backgroundImageRoutes: FastifyPluginAsyncZod = async (app) => {
  // GET /background-images — Public list with presigned thumbnail URLs
  app.route({
    method: "GET",
    url: "/background-images",
    schema: {
      tags: ["BackgroundImages"],
      operationId: "listBackgroundImages",
      summary: "List all background images",
      response: {
        200: z.object({ images: z.array(BackgroundImageResponseSchema) }),
        400: ErrorResponseSchema,
      },
    },
    handler: async (_request, reply) => {
      const images = await service.listAll();
      return reply.send({ images });
    },
  });

  // GET /background-images/:id/image — Public redirect to presigned URL
  app.route({
    method: "GET",
    url: "/background-images/:id/image",
    schema: {
      tags: ["BackgroundImages"],
      operationId: "getBackgroundImage",
      summary: "Get background image (redirect to S3)",
      params: z.object({ id: z.string() }),
      querystring: z.object({
        type: z.enum(["full", "thumb"]).default("full"),
      }),
      response: {
        302: z.never(),
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const url = await service.getImageUrl(request.params.id, request.query.type);
      return reply.redirect(url);
    },
  });

  // POST /background-images — Admin upload
  app.route({
    method: "POST",
    url: "/background-images",
    preValidation: adminPreValidation,
    schema: {
      tags: ["BackgroundImages"],
      operationId: "uploadBackgroundImage",
      summary: "Upload a background image (admin only)",
      response: {
        200: z.object({ image: BackgroundImageResponseSchema }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const file = await request.file();
      if (!file) {
        throw new ValidationError("No file uploaded");
      }

      if (!file.mimetype.startsWith("image/")) {
        throw new ValidationError("Only image files are allowed");
      }

      // Read the optional 'name' field from multipart
      // Note: @fastify/multipart processes fields in order, but file() consumes the file.
      // The name field should be sent before the file in the FormData.
      const nameField = file.fields?.name;
      const name =
        nameField && "value" in nameField ? (nameField.value as string) || undefined : undefined;

      const chunks: Buffer[] = [];
      const maxSize = 10 * 1024 * 1024;
      let totalSize = 0;

      for await (const chunk of file.file) {
        totalSize += chunk.length;
        if (totalSize > maxSize) {
          throw new ValidationError("Image file too large. Maximum size is 10MB.");
        }
        chunks.push(chunk);
      }

      const buffer = Buffer.concat(chunks);
      const image = await service.upload(buffer, file.filename, name);
      return reply.send({ image });
    },
  });

  // PATCH /background-images/:id — Admin rename
  app.route({
    method: "PATCH",
    url: "/background-images/:id",
    preValidation: adminPreValidation,
    schema: {
      tags: ["BackgroundImages"],
      operationId: "updateBackgroundImage",
      summary: "Update background image name (admin only)",
      params: z.object({ id: z.string() }),
      body: UpdateBackgroundImageSchema,
      response: {
        200: z.object({ image: BackgroundImageResponseSchema }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const image = await service.rename(request.params.id, request.body.name ?? "");
      return reply.send({ image });
    },
  });

  // PATCH /background-images/order — Admin reorder
  app.route({
    method: "PATCH",
    url: "/background-images/order",
    preValidation: adminPreValidation,
    schema: {
      tags: ["BackgroundImages"],
      operationId: "reorderBackgroundImages",
      summary: "Reorder background images (admin only)",
      body: ReorderBackgroundImagesSchema,
      response: {
        200: z.object({ success: z.boolean() }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      await service.reorder(request.body.ids);
      return reply.send({ success: true });
    },
  });

  // DELETE /background-images/:id — Admin delete
  app.route({
    method: "DELETE",
    url: "/background-images/:id",
    preValidation: adminPreValidation,
    schema: {
      tags: ["BackgroundImages"],
      operationId: "deleteBackgroundImage",
      summary: "Delete a background image (admin only)",
      params: z.object({ id: z.string() }),
      response: {
        200: z.object({ success: z.boolean() }),
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      await service.delete(request.params.id);
      return reply.send({ success: true });
    },
  });
};
```

- [ ] **Step 5: Register routes in server.ts**

In `apps/server/src/server.ts`:
1. Add import: `import { backgroundImageRoutes } from "./modules/background-image/routes.js";`
2. Add registration after `app.register(ldapRoutes);`: `app.register(backgroundImageRoutes);`

- [ ] **Step 6: Run type-check**

```bash
pnpm --filter @ouitransfer/server exec tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/modules/background-image/ apps/server/src/server.ts
git commit -m "feat: add background-image server module with 6 endpoints"
```

---

## Task 4: Server — Reverse Share DTO + Repository Changes

**Files:**
- Modify: `apps/server/src/modules/reverse-share/dto.ts`
- Modify: `apps/server/src/modules/reverse-share/repository.ts`
- Modify: `apps/server/src/modules/reverse-share/service.ts`

- [ ] **Step 1: Add backgroundImageId to reverse share DTOs**

In `apps/server/src/modules/reverse-share/dto.ts`:

1. In `CreateReverseShareSchema` (line 5), add after `pageLayout`:
```ts
  backgroundImageId: z.string().nullable().optional().describe("Background image ID for WeTransfer layout"),
```

2. In `UpdateReverseShareSchema` (line 43), add after `pageLayout`:
```ts
  backgroundImageId: z.string().nullable().optional().describe("Background image ID for WeTransfer layout"),
```

3. In `ReverseShareResponseSchema` (line 71), add after `pageLayout`:
```ts
  backgroundImageId: z.string().nullable().describe("Background image ID"),
```

4. In `ReverseSharePublicSchema` (line 101), add after `pageLayout`:
```ts
  backgroundImageId: z.string().nullable().describe("Background image ID"),
```

- [ ] **Step 2: Update repository to include backgroundImage in queries**

In `apps/server/src/modules/reverse-share/repository.ts`, every `include` block that has `files: true` and `alias: true` should also have `backgroundImage: true` added (or just pass through the `backgroundImageId` which is already on the model).

Actually, since we only need the ID (not the full relation) in responses, and `backgroundImageId` is a scalar field on `ReverseShare`, it will be included automatically in all Prisma queries. No repository changes needed.

- [ ] **Step 3: Update service ReverseShareData interface**

In `apps/server/src/modules/reverse-share/service.ts`, add to the `ReverseShareData` interface (around line 14), after `pageLayout`:

```ts
  backgroundImageId: string | null;
```

- [ ] **Step 4: Update formatReverseShareResponse in service**

Search for the `formatReverseShareResponse` method in the service. It maps DB data to the response schema. Ensure `backgroundImageId` is included. Since it's a scalar field on the model, Prisma will return it automatically, and the Zod schema parse will pick it up — as long as the `ReverseShareData` interface includes it.

- [ ] **Step 5: Run type-check**

```bash
pnpm --filter @ouitransfer/server exec tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/modules/reverse-share/dto.ts apps/server/src/modules/reverse-share/service.ts
git commit -m "feat: add backgroundImageId to reverse share DTOs and service"
```

---

## Task 5: Frontend — Proxy Routes, HTTP Client, Query Keys

**Files:**
- Modify: `apps/web/src/lib/proxy-routes.ts`
- Create: `apps/web/src/http/endpoints/background-images/index.ts`
- Create: `apps/web/src/http/endpoints/background-images/types.ts`
- Modify: `apps/web/src/http/endpoints/index.ts`
- Modify: `apps/web/src/lib/query-keys.ts`

- [ ] **Step 1: Add proxy routes for background-images**

In `apps/web/src/lib/proxy-routes.ts`, add a new section after the APP section (after line 111):

```ts
  // ═══════════════════════════════════════════════════════════════
  // BACKGROUND IMAGES
  // ═══════════════════════════════════════════════════════════════
  r("GET", "background-images", "/background-images"),
  r("POST", "background-images/upload", "/background-images", { body: "raw" }),
  r("PATCH", "background-images/order", "/background-images/order"),
  r("GET", "background-images/:id/image", "/background-images/:id/image", { query: true }),
  r("PATCH", "background-images/:id", "/background-images/:id"),
  r("DELETE", "background-images/:id", "/background-images/:id"),
```

Note: more specific routes (`order`, `upload`) must come before the dynamic `:id` routes.

- [ ] **Step 2: Create types.ts**

Create `apps/web/src/http/endpoints/background-images/types.ts`:

```ts
import type { AxiosResponse } from "axios";

export interface BackgroundImage {
  id: string;
  name: string | null;
  s3Key: string;
  thumbnailS3Key: string;
  thumbnailUrl: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ListBackgroundImages200 {
  images: BackgroundImage[];
}

export interface UploadBackgroundImage200 {
  image: BackgroundImage;
}

export interface UpdateBackgroundImage200 {
  image: BackgroundImage;
}

export type ListBackgroundImagesResult = AxiosResponse<ListBackgroundImages200>;
export type UploadBackgroundImageResult = AxiosResponse<UploadBackgroundImage200>;
export type UpdateBackgroundImageResult = AxiosResponse<UpdateBackgroundImage200>;
export type DeleteBackgroundImageResult = AxiosResponse<{ success: boolean }>;
export type ReorderBackgroundImagesResult = AxiosResponse<{ success: boolean }>;
```

- [ ] **Step 3: Create index.ts**

Create `apps/web/src/http/endpoints/background-images/index.ts`:

```ts
import type { AxiosRequestConfig } from "axios";

import apiInstance from "@/config/api";
import type {
  DeleteBackgroundImageResult,
  ListBackgroundImagesResult,
  ReorderBackgroundImagesResult,
  UpdateBackgroundImageResult,
  UploadBackgroundImageResult,
} from "./types";

export const listBackgroundImages = (
  options?: AxiosRequestConfig,
): Promise<ListBackgroundImagesResult> => {
  return apiInstance.get("/api/background-images", options);
};

export const uploadBackgroundImage = (
  file: File,
  name?: string,
  options?: AxiosRequestConfig,
): Promise<UploadBackgroundImageResult> => {
  const formData = new FormData();
  if (name) {
    formData.append("name", name);
  }
  formData.append("file", file);

  return apiInstance.post("/api/background-images/upload", formData, {
    ...options,
    headers: {
      ...options?.headers,
      "Content-Type": "multipart/form-data",
    },
  });
};

export const updateBackgroundImage = (
  id: string,
  data: { name?: string },
  options?: AxiosRequestConfig,
): Promise<UpdateBackgroundImageResult> => {
  return apiInstance.patch(`/api/background-images/${id}`, data, options);
};

export const reorderBackgroundImages = (
  ids: string[],
  options?: AxiosRequestConfig,
): Promise<ReorderBackgroundImagesResult> => {
  return apiInstance.patch("/api/background-images/order", { ids }, options);
};

export const deleteBackgroundImage = (
  id: string,
  options?: AxiosRequestConfig,
): Promise<DeleteBackgroundImageResult> => {
  return apiInstance.delete(`/api/background-images/${id}`, options);
};
```

- [ ] **Step 4: Re-export from endpoints index**

In `apps/web/src/http/endpoints/index.ts`, add:

```ts
export * from "./background-images";
```

- [ ] **Step 5: Add query keys**

In `apps/web/src/lib/query-keys.ts`, add after `reverseShares`:

```ts
  backgroundImages: {
    all: ["backgroundImages"] as const,
    list: () => [...queryKeys.backgroundImages.all, "list"] as const,
  },
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/proxy-routes.ts apps/web/src/http/endpoints/background-images/ apps/web/src/http/endpoints/index.ts apps/web/src/lib/query-keys.ts
git commit -m "feat: add background-images frontend HTTP client and proxy routes"
```

---

## Task 6: TD-14 — Footer Components + Settings i18n

**Files:**
- Modify: `apps/web/src/components/ui/default-footer.tsx`
- Modify: `apps/web/src/app/(shares)/r/[alias]/components/transparent-footer.tsx`
- Modify: `apps/web/src/app/settings/constants.ts`
- Modify: `apps/web/messages/en-US.json` (+ 22 other locale files)

- [ ] **Step 1: Update DefaultFooter to read config**

Replace `apps/web/src/components/ui/default-footer.tsx` with:

```tsx
"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import { useSecureConfigValue } from "@/hooks/use-secure-configs";

const version = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";

export function DefaultFooter() {
  const t = useTranslations();
  const { value: hideVersion } = useSecureConfigValue("hideVersion");
  const { value: footerEnabled } = useSecureConfigValue("footerEnabled");
  const { value: footerText } = useSecureConfigValue("footerText");
  const { value: footerUrl } = useSecureConfigValue("footerUrl");

  if (footerEnabled === "false") {
    return null;
  }

  const shouldHideVersion = hideVersion === "true";
  const displayText = footerText || "Ouitransfer";
  const displayUrl = footerUrl || "https://example.com";

  return (
    <footer className="w-full flex items-center justify-center py-3 h-16">
      <div className="flex flex-col items-center">
        <Link
          target="_blank"
          className="flex items-center gap-1 text-current"
          href={displayUrl}
          title={t("footer.projectHomepage")}
        >
          <span className="text-default-600 text-xs sm:text-sm">{t("footer.poweredBy")}</span>
          <p className="text-primary text-xs sm:text-sm">{displayText}</p>
        </Link>
        {!shouldHideVersion && <span className="text-default-500 text-[11px] mt-1">v{version}</span>}
      </div>
    </footer>
  );
}
```

- [ ] **Step 2: Update TransparentFooter to read config**

Replace `apps/web/src/app/(shares)/r/[alias]/components/transparent-footer.tsx` with:

```tsx
"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import { useSecureConfigValue } from "@/hooks/use-secure-configs";

const version = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";

export function TransparentFooter() {
  const t = useTranslations();
  const { value: hideVersion } = useSecureConfigValue("hideVersion");
  const { value: footerEnabled } = useSecureConfigValue("footerEnabled");
  const { value: footerText } = useSecureConfigValue("footerText");
  const { value: footerUrl } = useSecureConfigValue("footerUrl");

  if (footerEnabled === "false") {
    return null;
  }

  const shouldHideVersion = hideVersion === "true";
  const displayText = footerText || "Ouitransfer";
  const displayUrl = footerUrl || "https://example.com";

  return (
    <footer className="absolute bottom-0 start-0 end-0 z-50 w-full flex items-center justify-center py-3 h-16 pointer-events-none">
      <div className="flex flex-col items-center pointer-events-auto">
        <Link
          target="_blank"
          className="flex items-center gap-1 text-white/80 hover:text-primary transition-colors"
          href={displayUrl}
          title={t("footer.projectHomepage")}
        >
          <span className="text-white/70 text-xs sm:text-sm">{t("footer.poweredBy")}</span>
          <p className="text-primary text-xs sm:text-sm font-medium cursor-pointer hover:text-primary/80">
            {displayText}
          </p>
        </Link>
        {!shouldHideVersion && <span className="text-white text-[11px] mt-1">v{version}</span>}
      </div>
    </footer>
  );
}
```

- [ ] **Step 3: Add footer field descriptions to settings constants**

In `apps/web/src/app/settings/constants.ts`, add to `createFieldDescriptions` (after the `serverUrl` entry around line 41):

```ts
  footerEnabled: t("settings.fields.footerEnabled.description"),
  footerText: t("settings.fields.footerText.description"),
  footerUrl: t("settings.fields.footerUrl.description"),
```

- [ ] **Step 4: Add i18n keys for footer settings in en-US.json**

In `apps/web/messages/en-US.json`, in the `settings.fields` object, add after the `hideVersion` entry:

```json
      "footerEnabled": {
        "title": "Show Footer",
        "description": "Display the footer bar at the bottom of all pages"
      },
      "footerText": {
        "title": "Footer Text",
        "description": "Company or organization name displayed in the footer"
      },
      "footerUrl": {
        "title": "Footer URL",
        "description": "Link URL for the footer text"
      },
```

- [ ] **Step 5: Add i18n keys to all 22 other locale files**

For each non-en-US locale file in `apps/web/messages/`, add the same 3 entries in `settings.fields` (English text is acceptable — translations are contributed by the community later). The 22 locales are: ar-SA, de-DE, el-GR, es-ES, fa-IR, fr-FR, he-IL, hi-IN, id-ID, it-IT, ja-JP, ko-KR, nl-NL, pl-PL, pt-BR, ru-RU, sv-SE, th-TH, tr-TR, uk-UA, vi-VN, zh-CN.

- [ ] **Step 6: Run type-check**

```bash
pnpm --filter @ouitransfer/web exec tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/ui/default-footer.tsx apps/web/src/app/(shares)/r/[alias]/components/transparent-footer.tsx apps/web/src/app/settings/constants.ts apps/web/messages/
git commit -m "feat(TD-14): make footer text, URL, and visibility configurable"
```

---

## Task 7: Frontend — Background Image Manager in Settings

**Files:**
- Create: `apps/web/src/app/settings/components/background-image-manager.tsx`
- Modify: `apps/web/src/app/settings/components/settings-form.tsx`
- Modify: `apps/web/src/app/settings/constants.ts`
- Modify: `apps/web/messages/en-US.json` (+ 22 locales)

- [ ] **Step 1: Create background-image-manager.tsx**

Create `apps/web/src/app/settings/components/background-image-manager.tsx`:

```tsx
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, ImagePlus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  deleteBackgroundImage,
  listBackgroundImages,
  uploadBackgroundImage,
} from "@/http/endpoints/background-images";
import type { BackgroundImage } from "@/http/endpoints/background-images/types";
import { queryKeys } from "@/lib/query-keys";

export function BackgroundImageManager() {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [uploading, setUploading] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.backgroundImages.list(),
    queryFn: async () => {
      const res = await listBackgroundImages();
      return res.data.images;
    },
  });

  const images = data ?? [];

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteBackgroundImage(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.backgroundImages.all });
      toast.success(t("backgroundImages.deleteSuccess"));
    },
    onError: () => {
      toast.error(t("backgroundImages.deleteError"));
    },
  });

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      await uploadBackgroundImage(file);
      queryClient.invalidateQueries({ queryKey: queryKeys.backgroundImages.all });
      toast.success(t("backgroundImages.uploadSuccess"));
    } catch {
      toast.error(t("backgroundImages.uploadError"));
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleDelete = (id: string) => {
    if (window.confirm(t("backgroundImages.deleteConfirm"))) {
      deleteMutation.mutate(id);
    }
  };

  return (
    <Card>
      <CardHeader
        className="flex flex-row items-center justify-between cursor-pointer py-0"
        onClick={() => setIsCollapsed((prev) => !prev)}
      >
        <div className="flex flex-row items-center gap-8">
          <ImagePlus className="text-xl text-muted-foreground" />
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold">{t("settings.groups.backgrounds.title")}</h2>
            <p className="text-sm text-muted-foreground">
              {t("settings.groups.backgrounds.description")}
            </p>
          </div>
        </div>
        {isCollapsed ? (
          <ChevronDown className="text-muted-foreground" />
        ) : (
          <ChevronUp className="text-muted-foreground" />
        )}
      </CardHeader>
      <CardContent className={isCollapsed ? "hidden" : "block"}>
        <Separator className="my-6" />

        {isLoading ? (
          <div className="text-sm text-muted-foreground">{t("common.loading")}</div>
        ) : images.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("backgroundImages.empty")}</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {images.map((image: BackgroundImage) => (
              <div key={image.id} className="group relative rounded-lg overflow-hidden border">
                <div className="aspect-video bg-muted">
                  <img
                    src={image.thumbnailUrl}
                    alt={image.name || "Background"}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="p-2 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground truncate">
                    {image.name || t("backgroundImages.untitled")}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => handleDelete(image.id)}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleUpload}
          />
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2"
          >
            <ImagePlus className="h-4 w-4" />
            {uploading ? t("backgroundImages.uploading") : t("backgroundImages.add")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Add backgrounds group to settings-form.tsx**

In `apps/web/src/app/settings/components/settings-form.tsx`:

1. Import the component:
```ts
import { BackgroundImageManager } from "./background-image-manager";
```

2. Add `"backgrounds"` to `GROUP_ORDER` at the end:
```ts
const GROUP_ORDER: string[] = ["general", "email", "auth-providers", "security", "storage", "backgrounds"];
```

3. In the `sortedGroups.map` callback, add a case for `backgrounds` before the `auth-providers` case:
```tsx
        if (group === "backgrounds") {
          return <BackgroundImageManager key={group} />;
        }
```

- [ ] **Step 3: Add backgrounds group metadata to constants.ts**

In `apps/web/src/app/settings/constants.ts`:

1. Add import: `import { Database, ImagePlus, Mail, Settings, Shield, UserCheck } from "lucide-react";`
   (add `ImagePlus` to the existing import)

2. Add to `createGroupMetadata`:
```ts
  backgrounds: {
    title: t("settings.groups.backgrounds.title"),
    description: t("settings.groups.backgrounds.description"),
    icon: ImagePlus,
  },
```

- [ ] **Step 4: Add i18n keys for backgrounds in en-US.json**

In `apps/web/messages/en-US.json`:

1. In `settings.groups`, add:
```json
      "backgrounds": {
        "title": "Background Images",
        "description": "Manage background images for WeTransfer-style upload pages"
      }
```

2. Add a top-level `backgroundImages` section:
```json
  "backgroundImages": {
    "empty": "No background images uploaded. Upload images to enable custom backgrounds for WeTransfer-style shares.",
    "add": "Add Image",
    "uploading": "Uploading...",
    "uploadSuccess": "Image uploaded successfully",
    "uploadError": "Failed to upload image",
    "deleteConfirm": "Are you sure you want to delete this background image?",
    "deleteSuccess": "Image deleted successfully",
    "deleteError": "Failed to delete image",
    "untitled": "Untitled"
  }
```

- [ ] **Step 5: Add i18n keys to all 22 other locale files**

Add the same `backgroundImages` section and `settings.groups.backgrounds` to all 22 non-en-US locale files.

- [ ] **Step 6: Run type-check**

```bash
pnpm --filter @ouitransfer/web exec tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/settings/components/background-image-manager.tsx apps/web/src/app/settings/components/settings-form.tsx apps/web/src/app/settings/constants.ts apps/web/messages/
git commit -m "feat(TD-12): add background image manager in admin settings"
```

---

## Task 8: Frontend — Image Picker in Reverse Share Form + Details Modal

**Files:**
- Create: `apps/web/src/app/(shares)/reverse-shares/components/background-image-picker.tsx`
- Modify: `apps/web/src/app/(shares)/reverse-shares/components/create-reverse-share/types.ts`
- Modify: `apps/web/src/app/(shares)/reverse-shares/components/create-reverse-share/basic-info-section.tsx`
- Modify: `apps/web/src/app/(shares)/reverse-shares/components/reverse-share-details-modal.tsx`
- Modify: `apps/web/messages/en-US.json` (+ 22 locales)

- [ ] **Step 1: Add backgroundImageId to form types**

In `apps/web/src/app/(shares)/reverse-shares/components/create-reverse-share/types.ts`:

1. Add to `CreateReverseShareFormData` interface:
```ts
  backgroundImageId?: string | null;
```

2. Add to `DEFAULT_FORM_VALUES`:
```ts
  backgroundImageId: null,
```

- [ ] **Step 2: Create reusable background-image-picker.tsx**

Create `apps/web/src/app/(shares)/reverse-shares/components/background-image-picker.tsx`.
This component is shared between the creation form and the details modal — it uses `value`/`onChange` props (no form dependency):

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { Shuffle } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import { listBackgroundImages } from "@/http/endpoints/background-images";
import type { BackgroundImage } from "@/http/endpoints/background-images/types";
import { queryKeys } from "@/lib/query-keys";

interface BackgroundImagePickerProps {
  value: string | null | undefined;
  onChange: (id: string | null) => void;
}

export function BackgroundImagePicker({ value, onChange }: BackgroundImagePickerProps) {
  const t = useTranslations();

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.backgroundImages.list(),
    queryFn: async () => {
      const res = await listBackgroundImages();
      return res.data.images;
    },
  });

  const images = data ?? [];

  if (isLoading) {
    return null;
  }

  if (images.length === 0) {
    return (
      <div className="rounded-lg border bg-muted/50 p-3">
        <p className="text-sm text-muted-foreground">
          {t("reverseShares.form.backgroundImage.none")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <label className="text-sm font-medium">
        {t("reverseShares.form.backgroundImage.title")}
      </label>
      <p className="text-xs text-muted-foreground">
        {t("reverseShares.form.backgroundImage.description")}
      </p>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {/* Random option */}
        <button
          type="button"
          onClick={() => onChange(null)}
          className={cn(
            "relative aspect-video rounded-lg border-2 flex items-center justify-center bg-muted transition-all",
            value === null || value === undefined
              ? "border-primary ring-2 ring-primary/20"
              : "border-transparent hover:border-muted-foreground/30",
          )}
        >
          <div className="flex flex-col items-center gap-1">
            <Shuffle className="h-5 w-5 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground font-medium">
              {t("reverseShares.form.backgroundImage.random")}
            </span>
          </div>
        </button>

        {/* Image options */}
        {images.map((image: BackgroundImage) => (
          <button
            key={image.id}
            type="button"
            onClick={() => onChange(image.id)}
            className={cn(
              "relative aspect-video rounded-lg border-2 overflow-hidden transition-all",
              value === image.id
                ? "border-primary ring-2 ring-primary/20"
                : "border-transparent hover:border-muted-foreground/30",
            )}
          >
            <img
              src={image.thumbnailUrl}
              alt={image.name || "Background"}
              className="w-full h-full object-cover"
            />
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Show image picker when WETRANSFER is selected in creation form**

In `apps/web/src/app/(shares)/reverse-shares/components/create-reverse-share/basic-info-section.tsx`:

1. Add import:
```ts
import { BackgroundImagePicker } from "../background-image-picker";
```

2. After the `pageLayout` FormField (after line 97 `/>`, before the closing `</div>`), add:
```tsx
      {form.watch("pageLayout") === "WETRANSFER" && (
        <BackgroundImagePicker
          value={form.watch("backgroundImageId")}
          onChange={(id) => form.setValue("backgroundImageId", id)}
        />
      )}
```

- [ ] **Step 4: Add i18n keys for image picker**

In `apps/web/messages/en-US.json`, in the `reverseShares.form` section, add:

```json
      "backgroundImage": {
        "title": "Background Image",
        "description": "Choose a background image for the upload page",
        "random": "Random",
        "none": "No background images available. An admin can upload images in Settings."
      }
```

- [ ] **Step 5: Add i18n keys to all 22 other locale files**

Same structure, English text.

- [ ] **Step 6: Ensure form submission includes backgroundImageId**

The `createReverseShare` HTTP call already sends the full form data. The server DTO now accepts `backgroundImageId`. Verify that the form submission code (`use-create-reverse-share.ts` or wherever the form submits) passes `backgroundImageId` from the form data to the API call. Search the file that calls `createReverseShare()` and confirm the field is forwarded.

- [ ] **Step 7: Add image picker to reverse-share-details-modal.tsx**

In `apps/web/src/app/(shares)/reverse-shares/components/reverse-share-details-modal.tsx`:

1. Add import:
```ts
import { BackgroundImagePicker } from "./background-image-picker";
```

2. After the `pageLayout` EditableField (line ~206, after the closing `/>` of the EditableField), add a conditional image picker that appears when pageLayout is WETRANSFER:
```tsx
                {(getDisplayValue(reverseShare, "pageLayout", pendingChanges) === "WETRANSFER") && (
                  <div className="space-y-2">
                    <BackgroundImagePicker
                      value={getDisplayValue(reverseShare, "backgroundImageId", pendingChanges) as string | null}
                      onChange={(id) => handleUpdateField("backgroundImageId", id)}
                    />
                  </div>
                )}
```

This uses the same `handleUpdateField` pattern as all other editable fields in the modal — changes are saved immediately via `onUpdateReverseShare`.

- [ ] **Step 8: Run type-check**

```bash
pnpm --filter @ouitransfer/web exec tsc --noEmit
```

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/app/(shares)/reverse-shares/components/ apps/web/messages/
git commit -m "feat(TD-12): add background image picker in reverse share form and details modal"
```

---

## Task 9: Frontend — WeTransfer Layout Dynamic Backgrounds + Cleanup

**Files:**
- Modify: `apps/web/src/app/(shares)/r/[alias]/components/we-transfer-layout.tsx`
- Modify: `apps/web/src/app/(shares)/r/[alias]/constants/index.ts`
- Delete: `apps/web/public/assets/wetransfer-bgs/*.jpg` (8 files)

- [ ] **Step 1: Remove BACKGROUND_IMAGES from constants**

In `apps/web/src/app/(shares)/r/[alias]/constants/index.ts`, delete the entire `BACKGROUND_IMAGES` constant (lines 48-57).

- [ ] **Step 2: Rewrite we-transfer-layout.tsx background logic**

Replace `apps/web/src/app/(shares)/r/[alias]/components/we-transfer-layout.tsx` with dynamic S3 loading. Key changes:

1. Remove the import of `BACKGROUND_IMAGES` from `../constants`
2. Remove `getRandomBackgroundImage()` and `useBackgroundImage()` entirely
3. Add a new `useDynamicBackground(backgroundImageId: string | null)` hook that:
   - If `backgroundImageId` is a string: fetches `GET /api/background-images/{id}/image?type=full` to get the redirect URL, uses it as the background
   - If `backgroundImageId` is null: fetches `GET /api/background-images` (list), picks a random one, fetches its full image
   - If the list is empty: returns `{ mode: "gradient" }` — no image
4. Update `BackgroundLayer` to handle three states:
   - Image loaded: render `backgroundImage: url(...)`
   - Gradient fallback: render CSS gradient (`linear-gradient(135deg, oklch(0.3 0.1 265), oklch(0.15 0.05 280), oklch(0.25 0.08 250))`)
   - Loading: show pulse animation
5. Remove the loading state text (replace with a subtle CSS animation)

Here is the replacement code:

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Clock, Info, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { LanguageSwitcher } from "@/components/general/language-switcher";
import { ModeToggle } from "@/components/general/mode-toggle";
import { listBackgroundImages } from "@/http/endpoints/background-images";
import { queryKeys } from "@/lib/query-keys";
import { logger } from "@/lib/logger";
import { MESSAGE_TYPES } from "../constants";
import type { WeTransferLayoutProps } from "../types";
import { FileUploadSection } from "./file-upload-section";
import { WeTransferStatusMessage } from "./shared/status-message";
import { TransparentFooter } from "./transparent-footer";

const GRADIENT_FALLBACK =
  "linear-gradient(135deg, oklch(0.3 0.1 265), oklch(0.15 0.05 280), oklch(0.25 0.08 250))";

type BackgroundState =
  | { mode: "loading" }
  | { mode: "image"; url: string }
  | { mode: "gradient" };

function useDynamicBackground(backgroundImageId: string | null | undefined): BackgroundState {
  const [state, setState] = useState<BackgroundState>({ mode: "loading" });

  // Fetch the list only when we need a random pick (no specific ID)
  const { data: imageList } = useQuery({
    queryKey: queryKeys.backgroundImages.list(),
    queryFn: async () => {
      const res = await listBackgroundImages();
      return res.data.images;
    },
    enabled: !backgroundImageId,
  });

  // Determine which image ID to load
  const resolvedId = useMemo(() => {
    if (backgroundImageId) return backgroundImageId;
    if (!imageList || imageList.length === 0) return null;
    const randomIndex = Math.floor(Math.random() * imageList.length);
    return imageList[randomIndex].id;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backgroundImageId, imageList]);

  useEffect(() => {
    if (resolvedId === null) {
      // No images available → gradient
      if (!backgroundImageId && imageList !== undefined) {
        setState({ mode: "gradient" });
      }
      return;
    }

    const imageUrl = `/api/background-images/${resolvedId}/image?type=full`;
    const img = new Image();
    img.onload = () => setState({ mode: "image", url: img.src });
    img.onerror = () => {
      logger.error("Failed to load background image", { id: resolvedId });
      setState({ mode: "gradient" });
    };
    img.src = imageUrl;
  }, [resolvedId, backgroundImageId, imageList]);

  return state;
}

const HeaderControls = () => (
  <div className="absolute top-4 end-4 md:top-6 md:end-6 z-40 flex items-center gap-2">
    <div className="bg-white/10 dark:bg-black/20 backdrop-blur-xs border border-white/20 dark:border-white/10 rounded-lg p-1">
      <LanguageSwitcher />
    </div>
    <div className="bg-white/10 dark:bg-black/20 backdrop-blur-xs border border-white/20 dark:border-white/10 rounded-lg p-1">
      <ModeToggle />
    </div>
  </div>
);

const BackgroundLayer = ({ background }: { background: BackgroundState }) => (
  <>
    <div className="absolute inset-0 z-0 bg-background" />
    {background.mode === "image" && (
      <div
        className="absolute inset-0 z-10"
        style={{
          backgroundImage: `url(${background.url})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      />
    )}
    {background.mode === "gradient" && (
      <div
        className="absolute inset-0 z-10"
        style={{ background: GRADIENT_FALLBACK }}
      />
    )}
    <div className="absolute inset-0 bg-black/40 z-20" />
  </>
);

export function WeTransferLayout({
  reverseShare,
  password,
  alias,
  isMaxFilesReached,
  hasUploadedSuccessfully,
  onUploadSuccess,
  isLinkInactive,
  isLinkNotFound,
  isLinkExpired,
}: WeTransferLayoutProps) {
  const background = useDynamicBackground(reverseShare?.backgroundImageId ?? null);
  const t = useTranslations();

  const getUploadSectionContent = () => {
    if (hasUploadedSuccessfully) {
      return (
        <WeTransferStatusMessage
          type={MESSAGE_TYPES.SUCCESS}
          icon={Check}
          titleKey="reverseShares.upload.success.title"
          descriptionKey="reverseShares.upload.success.description"
        />
      );
    }

    if (isLinkInactive) {
      return (
        <WeTransferStatusMessage
          type={MESSAGE_TYPES.INACTIVE}
          icon={TriangleAlert}
          titleKey="reverseShares.upload.linkInactive.title"
          descriptionKey="reverseShares.upload.linkInactive.description"
          showContactOwner
        />
      );
    }

    if (isLinkNotFound || !reverseShare) {
      return (
        <WeTransferStatusMessage
          type={MESSAGE_TYPES.NOT_FOUND}
          icon={TriangleAlert}
          titleKey="reverseShares.upload.linkNotFound.title"
          descriptionKey="reverseShares.upload.linkNotFound.description"
        />
      );
    }

    if (isLinkExpired) {
      return (
        <WeTransferStatusMessage
          type={MESSAGE_TYPES.EXPIRED}
          icon={Clock}
          titleKey="reverseShares.upload.linkExpired.title"
          descriptionKey="reverseShares.upload.linkExpired.description"
          showContactOwner
        />
      );
    }

    if (isMaxFilesReached) {
      return (
        <WeTransferStatusMessage
          type={MESSAGE_TYPES.MAX_FILES}
          icon={Info}
          titleKey="reverseShares.upload.maxFilesReached.title"
          descriptionKey="reverseShares.upload.maxFilesReached.description"
          showContactOwner
          reverseShare={reverseShare}
        />
      );
    }

    return (
      <FileUploadSection
        reverseShare={reverseShare}
        password={password}
        alias={alias}
        onUploadSuccess={onUploadSuccess}
      />
    );
  };

  return (
    <div className="min-h-screen relative overflow-hidden">
      <BackgroundLayer background={background} />
      <HeaderControls />

      {background.mode === "loading" && (
        <div className="absolute inset-0 z-30 flex items-center justify-center">
          <div className="animate-pulse text-white/70 text-sm">
            {t("reverseShares.upload.layout.loading")}
          </div>
        </div>
      )}

      <div className="relative z-30 min-h-screen flex items-center justify-start p-4 md:p-8 lg:p-12 xl:p-16">
        <div className="w-full max-w-md lg:max-w-lg xl:max-w-xl">
          <div className="bg-white dark:bg-black rounded-2xl shadow-2xl p-6 md:p-8 border border-white/20">
            <div className="text-start mb-6 md:mb-8">
              <h1 className="text-xl md:text-2xl lg:text-3xl font-bold text-foreground mb-2">
                {reverseShare?.name || t("reverseShares.upload.layout.defaultTitle")}
              </h1>
              {reverseShare?.description && (
                <p className="text-muted-foreground text-sm md:text-base">
                  {reverseShare.description}
                </p>
              )}
            </div>

            {getUploadSectionContent()}
          </div>
        </div>
      </div>

      <TransparentFooter />
    </div>
  );
}
```

- [ ] **Step 3: Verify WeTransferLayoutProps includes backgroundImageId**

Check `apps/web/src/app/(shares)/r/[alias]/types/index.ts` (or wherever `WeTransferLayoutProps` is defined). The `reverseShare` prop should include `backgroundImageId` from the API response. If the type comes from the reverse share HTTP response type, verify it includes `backgroundImageId: string | null`.

- [ ] **Step 4: Delete the 8 hardcoded images**

Delete all files in `apps/web/public/assets/wetransfer-bgs/`:
```bash
Remove-Item -Recurse -Force apps/web/public/assets/wetransfer-bgs
```

- [ ] **Step 5: Run type-check**

```bash
pnpm --filter @ouitransfer/web exec tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/(shares)/r/[alias]/components/we-transfer-layout.tsx apps/web/src/app/(shares)/r/[alias]/constants/index.ts
git rm -r apps/web/public/assets/wetransfer-bgs
git commit -m "feat(TD-12): dynamic S3 backgrounds with gradient fallback, delete hardcoded images"
```

---

## Task 10: Server Tests — Background Image Module

**Files:**
- Create: `apps/server/src/modules/background-image/__tests__/service.test.ts`
- Create: `apps/server/src/modules/background-image/__tests__/routes.test.ts`

- [ ] **Step 1: Write service unit tests**

Create `apps/server/src/modules/background-image/__tests__/service.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BackgroundImageService } from "../service.js";

describe("BackgroundImageService", () => {
  const service = new BackgroundImageService();

  describe("deriveNameFromFilename", () => {
    it("strips extension and title-cases", () => {
      expect(service.deriveNameFromFilename("mountain-sunset.jpg")).toBe("Mountain Sunset");
    });

    it("handles underscores", () => {
      expect(service.deriveNameFromFilename("city_skyline_night.png")).toBe("City Skyline Night");
    });

    it("handles filenames without extension", () => {
      expect(service.deriveNameFromFilename("ocean-waves")).toBe("Ocean Waves");
    });

    it("returns Untitled for empty string", () => {
      expect(service.deriveNameFromFilename(".jpg")).toBe("Untitled");
    });

    it("handles single word", () => {
      expect(service.deriveNameFromFilename("landscape.webp")).toBe("Landscape");
    });
  });
});
```

- [ ] **Step 2: Run unit tests**

```bash
pnpm --filter @ouitransfer/server test -- --run src/modules/background-image/__tests__/service.test.ts
```

- [ ] **Step 3: Write integration tests**

Create `apps/server/src/modules/background-image/__tests__/routes.test.ts`. These tests use `app.inject()` to test the full request lifecycle. The tests should:

1. Test `GET /background-images` returns empty array when no images exist
2. Test `POST /background-images` requires admin auth (returns 401 without auth)
3. Test `DELETE /background-images/:id` returns 404 for non-existent image
4. Test `PATCH /background-images/order` requires admin auth

Follow the existing test patterns in the project (check `apps/server/src/modules/app/__tests__/` or similar test files for the `app.inject()` pattern with auth setup).

- [ ] **Step 4: Run full server test suite**

```bash
pnpm --filter @ouitransfer/server test
```

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/modules/background-image/__tests__/
git commit -m "test: add background image service and route tests"
```

---

## Task 11: Run Full Validation

- [ ] **Step 1: Run all tests**

```bash
pnpm test
```

- [ ] **Step 2: Run type-check for all packages**

```bash
pnpm run type-check
```

- [ ] **Step 3: Run lint**

```bash
pnpm lint
```

- [ ] **Step 4: Fix any issues found**

- [ ] **Step 5: Update features/README.md**

Mark TD-14 and TD-12 as Done in the status table.

- [ ] **Step 6: Update features/SESSIONS.md**

Add a session entry with today's date and bullet points for what was done.

- [ ] **Step 7: Final commit**

```bash
git add features/README.md features/SESSIONS.md
git commit -m "docs: mark TD-14 and TD-12 as done"
```
