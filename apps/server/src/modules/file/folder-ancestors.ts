import type { PrismaClient } from "../../generated/prisma/client.js";

/**
 * Given a folderId, returns all ancestor folder IDs (including itself)
 * by walking UP the folder tree via a recursive CTE.
 * Returns empty array if folderId is null/undefined.
 *
 * Note: No userId filter — intentional. The folder tree is single-owner by design,
 * and the share match downstream re-scopes access. Adding userId here would break
 * anonymous access (the primary use case for this function).
 *
 * Safety: SQLite recursive CTEs terminate when no new rows are produced. A corrupted
 * parentId cycle would loop indefinitely — the LIMIT clause caps traversal at 100
 * levels (far beyond any realistic folder depth) as a defensive guard.
 *
 * @param client - Prisma client instance (injected for testability)
 * @param folderId - Starting folder ID to walk up from (null/undefined → [])
 */
export async function getAncestorFolderIds(
  client: PrismaClient,
  folderId: string | null | undefined,
): Promise<string[]> {
  if (!folderId) return [];
  const rows = await client.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE ancestors(id, "parentId") AS (
      SELECT id, "parentId" FROM "folders"
      WHERE id = ${folderId}
      UNION ALL
      SELECT f.id, f."parentId" FROM "folders" f
      JOIN ancestors a ON f.id = a."parentId"
    )
    SELECT id FROM ancestors
    LIMIT 100
  `;
  return rows.map((r) => r.id);
}
