# TD-14 / TD-12 — Footer configurable + Images de fond reverse shares

## Scope

Two related improvements bundled together:

1. **TD-14** — Make the footer text, URL, and visibility configurable by the admin (currently hardcoded).
2. **TD-12 extended** — Replace the 8 hardcoded JPGs of unknown license with an admin-managed image gallery stored in S3, and let users pick a background image when creating a WetTransfer-style reverse share.

## Decisions

| Question | Decision |
|----------|----------|
| Existing 8 images | Delete entirely — galerie vide par défaut |
| Fallback sans image | Dégradé indigo (gradient mesh cohérent avec le thème) |
| Stockage images | S3 (même bucket que les fichiers partagés, préfixé `backgrounds/`) |
| Traitement à l'upload | sharp: 1920px wide WebP (full) + 400px wide WebP (thumbnail) |
| Sélection par l'utilisateur | Grille de thumbnails + option "Aléatoire" (défaut) |
| Métadonnées | Nom optionnel (dérivé du fichier original si absent) |

---

## Part 1 — TD-14 : Footer configurable

### Schema (AppConfig seed)

3 new rows in `AppConfig`, group `general`:

| key | type | defaultValue | description |
|-----|------|--------------|-------------|
| `footerEnabled` | `boolean` | `true` | Show/hide the footer |
| `footerText` | `text` | `Ouitransfer` | Text displayed after "Powered by" |
| `footerUrl` | `text` | `https://example.com` | Link URL |

No new Prisma model — these are standard `AppConfig` rows like all other settings.

### Server

No new endpoints. The existing `GET /app/configs` (admin) and `GET /app` (public, returns selected configs) already serve config values. The 3 new keys must be added to the public response so non-admin pages can read them.

Verify: `apps/server/src/modules/app/service.ts` — the `getPublicConfig()` or equivalent method that populates `AppInfo` must include `footerEnabled`, `footerText`, `footerUrl`.

### Frontend

**AppInfo context** (`apps/web/src/contexts/app-info-context.tsx`):
- Add `footerEnabled`, `footerText`, `footerUrl` to the AppInfo type and context.

**Footer components** (2 files):
- `apps/web/src/components/ui/default-footer.tsx`
- `apps/web/src/app/(shares)/r/[alias]/components/transparent-footer.tsx`

Both currently hardcode `Ouitransfer` and `https://example.com`. Change to:
- Read `footerEnabled`, `footerText`, `footerUrl` from AppInfo context.
- If `footerEnabled === false` (or `"false"`): render nothing.
- Replace hardcoded company name with `footerText`.
- Replace hardcoded URL with `footerUrl`.
- Keep the existing i18n key `footer.poweredBy` ("Powered by") as the prefix.

**Settings page**:
- The 3 new keys auto-appear in the `general` group (no code change for rendering).
- Add i18n keys: `settings.fields.footerEnabled.{title,description}`, `settings.fields.footerText.{title,description}`, `settings.fields.footerUrl.{title,description}` in all 23 locales.

### i18n

6 new keys (3 settings × title+description) in 23 locales. English examples:
- `footerEnabled.title`: "Show Footer"
- `footerEnabled.description`: "Display the footer bar at the bottom of all pages"
- `footerText.title`: "Footer Text"
- `footerText.description`: "Company or organization name displayed in the footer"
- `footerUrl.title`: "Footer URL"
- `footerUrl.description`: "Link URL for the footer text"

---

## Part 2 — TD-12 extended : Background Images

### Schema (Prisma)

New model:

```prisma
model BackgroundImage {
  id             String   @id @default(cuid())
  name           String?
  s3Key          String
  thumbnailS3Key String
  sortOrder      Int      @default(0)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  reverseShares  ReverseShare[]
}
```

Modification to `ReverseShare`:

```prisma
model ReverseShare {
  // ... existing fields ...
  backgroundImageId  String?
  backgroundImage    BackgroundImage? @relation(fields: [backgroundImageId], references: [id], onDelete: SetNull)
}
```

`onDelete: SetNull` — if an admin deletes a background image, reverse shares that used it fall back to random/gradient.

### Server — New module `background-image`

Location: `apps/server/src/modules/background-image/`

Files: `dto.ts`, `repository.ts`, `service.ts`, `routes.ts`

#### Endpoints

| Method | Path | Auth | Body/Query | Response |
|--------|------|------|------------|----------|
| `GET` | `/background-images` | Public | — | `BackgroundImage[]` with presigned thumbnail URLs |
| `GET` | `/background-images/:id/image` | Public | `?type=full\|thumb` (default: full) | Redirect to presigned S3 URL (or stream) |
| `POST` | `/background-images` | Admin | Multipart: `file` (required), `name` (optional text field) | Created `BackgroundImage` |
| `PATCH` | `/background-images/:id` | Admin | `{ name?: string }` | Updated `BackgroundImage` |
| `PATCH` | `/background-images/order` | Admin | `{ ids: string[] }` | Bulk update `sortOrder` |
| `DELETE` | `/background-images/:id` | Admin | — | 204 |

#### Upload processing (POST)

1. Accept multipart file, validate MIME `image/*`, max 10 MB raw size.
2. Process with `sharp`:
   - **Full**: resize to 1920px wide (maintain aspect ratio), WebP quality 80 → `backgrounds/{id}.webp`
   - **Thumbnail**: resize to 400px wide, WebP quality 70 → `backgrounds/{id}_thumb.webp`
3. Upload both to S3 with `PutObjectCommand`.
4. Create `BackgroundImage` row in DB.
5. If `name` not provided, derive from original filename (strip extension, replace dashes/underscores with spaces, title-case).

#### Image serving (GET /:id/image)

Generate a presigned `GetObjectCommand` URL (expiry: 1 hour) and redirect (302). This avoids proxying large images through the server.

Alternative: for the list endpoint, include presigned thumbnail URLs inline in the response to avoid N+1 requests.

#### Delete

1. Delete both S3 objects (`s3Key`, `thumbnailS3Key`).
2. Delete DB row (cascade: `ReverseShare.backgroundImageId` set to null via `onDelete: SetNull`).

### Server — Reverse share modifications

- `CreateReverseShareSchema` in `reverse-share/dto.ts`: add `backgroundImageId: z.string().nullable().optional()`.
- `UpdateReverseShareSchema`: same addition.
- Service: validate that `backgroundImageId` exists in DB if provided (or skip — FK constraint handles it).
- Response schemas: include `backgroundImageId` in reverse share responses.

### Frontend — Admin settings: Background Image Manager

New component in the settings page or a dedicated sub-page. Given that settings is already grouped, a new group `backgrounds` in `GROUP_ORDER` is cleanest.

**Component: `BackgroundImageManager`**
- Displayed as a settings group card titled "Background Images" (or "Images de fond" in FR).
- Shows a grid of thumbnail cards (aspect-ratio 16:9 or similar).
- Each card: thumbnail image, name below, delete button (trash icon), inline-editable name on click.
- "Add Image" button → hidden file input, accepts `image/*`.
- Upload shows progress indicator.
- Sort order: v1 uses simple up/down arrows on each card. Drag-and-drop is a nice-to-have for later.
- Empty state: message "No background images uploaded. Upload images to enable custom backgrounds for WetTransfer-style shares."

Since this is not a standard text/boolean/number setting, it needs a **special case** in the settings page — similar to how `appLogo` has `LogoInput`, but as a full group section rather than an inline widget.

### Frontend — Reverse share form: Image Picker

**When `pageLayout === "WETRANSFER"`**, show an additional section in the creation form:

- Section title: "Background Image" / "Image de fond"
- Fetch `GET /background-images` (cached via TanStack Query).
- If no images available: show info text "No background images available. An admin must upload images in Settings." The form still works — the reverse share will use the gradient fallback.
- If images available: grid of selectable thumbnail cards + a special "Random" card (first position, selected by default). Clicking a thumbnail selects it (radio behavior). Selected card has a visual ring/border.
- Form value: `backgroundImageId = null` (random) or a specific ID.

Same picker in the **details modal** (`reverse-share-details-modal.tsx`) as an `EditableField`.

### Frontend — Upload page: `we-transfer-layout.tsx`

Replace the current `BACKGROUND_IMAGES` constant + random selection logic:

1. The reverse share data (from `GET /reverse-shares/:alias`) now includes `backgroundImageId`.
2. If `backgroundImageId` is set → fetch `GET /background-images/:id/image?type=full` → use as background.
3. If `backgroundImageId` is null:
   - Fetch `GET /background-images` (list).
   - If list is non-empty → pick random, fetch its full image.
   - If list is empty → render gradient fallback (indigo mesh gradient with dark overlay).
4. The gradient fallback: CSS gradient using the app's indigo palette, e.g.:
   ```css
   background: linear-gradient(135deg, oklch(0.3 0.1 265), oklch(0.15 0.05 280), oklch(0.25 0.08 250));
   ```
   With the existing `bg-black/40` overlay on top.

### Cleanup

- Delete `apps/web/public/assets/wetransfer-bgs/` (8 JPG files, ~27 MB total).
- Delete or empty `apps/web/src/app/(shares)/r/[alias]/constants/index.ts` (the `BACKGROUND_IMAGES` array).
- Remove any `.gitignore` entries related to `wetransfer-bgs`.

### Proxy routes

Add to `apps/web/src/app/api/[...proxy]/proxy-routes.ts`:

| Frontend path | Server path |
|---------------|-------------|
| `/api/background-images` | `/background-images` |
| `/api/background-images/:id` | `/background-images/:id` |
| `/api/background-images/:id/image` | `/background-images/:id/image` |
| `/api/background-images/order` | `/background-images/order` |

### i18n

New keys (23 locales):
- `settings.groups.backgrounds` (group title)
- `backgroundImages.title`, `backgroundImages.empty`, `backgroundImages.add`, `backgroundImages.delete`, `backgroundImages.deleteConfirm`, `backgroundImages.uploadError`, `backgroundImages.namePlaceholder`
- `reverseShares.form.backgroundImage.title`, `reverseShares.form.backgroundImage.random`, `reverseShares.form.backgroundImage.none`, `reverseShares.form.backgroundImage.description`

Approximate: ~15 new keys.

### Tests

**Server:**
- Unit: `BackgroundImageService` (upload processing, name derivation, delete cascade)
- Integration: all 6 endpoints via `app.inject()` (upload, list, get image, rename, reorder, delete)
- Integration: reverse share creation with `backgroundImageId`

**Web:**
- Type-check clean
- Existing reverse share tests still pass

### Error codes

Add to shared error codes if needed:
- `BACKGROUND_IMAGE_NOT_FOUND`
- `BACKGROUND_IMAGE_UPLOAD_FAILED`

### Migration path

Since the app is not in production: `prisma db push` / schema reset. No incremental migration needed.
