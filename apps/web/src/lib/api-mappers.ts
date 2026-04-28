/**
 * API-to-ViewModel mappers.
 *
 * The Fastify API returns data with `description: string | null`,
 * `size: string`, `folderId: string | null`, and `parentId: string | null`.
 * Frontend view-model types use `description?: string` (undefined, not null),
 * `size: number`, `folderId?: string`, and `parentId?: string`.
 *
 * These mapper functions perform the conversion explicitly so that every
 * downstream component receives correctly-typed values at runtime, instead
 * of relying on `as unknown as` double-casts that silently pass `null` where
 * `undefined` is expected.
 */

import type { FileItem, FolderItem } from "@/components/tables/files-table-types";
import type { FileItem as ApiFileItem } from "@/http/endpoints/files/types";
import type { FolderItem as ApiFolderItem } from "@/http/endpoints/folders/types";
import type {
  ShareFile as ApiShareFile,
  ShareFolder as ApiShareFolder,
} from "@/http/endpoints/shares/types";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Convert `string | null` → `string | undefined` (i.e. null → undefined). */
function nullToUndefined(value: string | null | undefined): string | undefined {
  return value ?? undefined;
}

// ---------------------------------------------------------------------------
// FileItem mappers
// ---------------------------------------------------------------------------

/**
 * Map an API `FileItem` (from `/api/files`) to the view-model `FileItem`.
 *
 * Transforms:
 * - `description`: `string | null` → `string | undefined`
 * - `size`: `string` → `number`
 * - `folderId`: `string | null` → `string | undefined`
 */
export function mapApiFile(apiFile: ApiFileItem): FileItem {
  return {
    id: apiFile.id,
    name: apiFile.name,
    description: nullToUndefined(apiFile.description),
    extension: apiFile.extension,
    size: Number(apiFile.size),
    objectName: apiFile.objectName,
    userId: apiFile.userId,
    folderId: nullToUndefined(apiFile.folderId),
    createdAt: apiFile.createdAt,
    updatedAt: apiFile.updatedAt,
  };
}

/** Map an array of API files. */
export function mapApiFiles(apiFiles: ApiFileItem[]): FileItem[] {
  return apiFiles.map(mapApiFile);
}

// ---------------------------------------------------------------------------
// FolderItem mappers
// ---------------------------------------------------------------------------

/**
 * Map an API `FolderItem` (from `/api/folders`) to the view-model `FolderItem`.
 *
 * Transforms:
 * - `description`: `string | null` → `string | undefined`
 * - `parentId`: `string | null` → `string | undefined`
 *
 * Note: The API `FolderItem` lacks `objectName` and has an optional `totalSize`.
 * The view-model `FolderItem` expects `objectName: string`. We set it to an
 * empty string since it is not provided by the list endpoint but is present
 * in the Prisma model. Components that need `objectName` should use the
 * register/create response which includes it.
 */
export function mapApiFolder(apiFolder: ApiFolderItem): FolderItem {
  return {
    id: apiFolder.id,
    name: apiFolder.name,
    description: nullToUndefined(apiFolder.description),
    objectName: "", // Not returned by the list endpoint
    parentId: nullToUndefined(apiFolder.parentId),
    userId: apiFolder.userId,
    createdAt: apiFolder.createdAt,
    updatedAt: apiFolder.updatedAt,
    totalSize: apiFolder.totalSize,
    _count: apiFolder._count,
  };
}

/** Map an array of API folders. */
export function mapApiFolders(apiFolders: ApiFolderItem[]): FolderItem[] {
  return apiFolders.map(mapApiFolder);
}

// ---------------------------------------------------------------------------
// Share file/folder mappers
// ---------------------------------------------------------------------------

/**
 * Map a `ShareFile` (from share API responses) to the view-model `FileItem`.
 *
 * `ShareFile` has the same shape as `FileItem` from the files API —
 * `description: string | null`, `size: string`, `folderId: string | null` —
 * so the same transformations apply.
 */
export function mapShareFile(shareFile: ApiShareFile): FileItem {
  return {
    id: shareFile.id,
    name: shareFile.name,
    description: nullToUndefined(shareFile.description),
    extension: shareFile.extension,
    size: Number(shareFile.size),
    objectName: shareFile.objectName,
    userId: shareFile.userId,
    folderId: nullToUndefined(shareFile.folderId),
    createdAt: shareFile.createdAt,
    updatedAt: shareFile.updatedAt,
  };
}

/** Map an array of share files. */
export function mapShareFiles(shareFiles: ApiShareFile[]): FileItem[] {
  return shareFiles.map(mapShareFile);
}

/**
 * Map a `ShareFolder` (from share API responses) to a share-compatible
 * view-model `FolderItem`.
 *
 * `ShareFolder` differs from `FolderItem` (API) by lacking `userId` and
 * `objectName`, and having `totalSize: string | null` instead of
 * `totalSize?: string`. We provide fallback values for the missing fields.
 *
 * Transforms:
 * - `description`: `string | null` → `string | undefined`
 * - `parentId`: `string | null` → `string | undefined`
 * - `totalSize`: `string | null` → `string | undefined`
 */
export function mapShareFolder(shareFolder: ApiShareFolder): FolderItem {
  return {
    id: shareFolder.id,
    name: shareFolder.name,
    description: nullToUndefined(shareFolder.description),
    objectName: "", // Not present in ShareFolder API type
    parentId: nullToUndefined(shareFolder.parentId),
    userId: "", // Not present in ShareFolder API type
    createdAt: shareFolder.createdAt,
    updatedAt: shareFolder.updatedAt,
    totalSize: nullToUndefined(shareFolder.totalSize),
    _count: shareFolder._count,
  };
}

/** Map an array of share folders. */
export function mapShareFolders(shareFolders: ApiShareFolder[]): FolderItem[] {
  return shareFolders.map(mapShareFolder);
}
