import type { FastifyRequest } from "fastify";
import { prisma } from "../../shared/prisma.js";
import { parseVisitorCookie } from "./visitor-cookie.js";

/** How a download/access recipient was attributed. */
export type IdentificationSource = "token" | "self_declared";

/** Minimal visitor-cookie shape needed to resolve a recipient. */
export interface ResolverCookie {
  /** Token-verified recipient id (written server-side at access time). */
  recipientId?: string;
  /** Self-declared email from the identification form. */
  email?: string;
}

export interface ResolvedDownloadRecipient {
  recipientId: string;
  identificationSource: IdentificationSource;
}

/**
 * Resolve which {@link ShareRecipient} a download (or access) should be linked to, using the
 * signed visitor identification cookie. This is the single implementation shared by the access
 * flow and the download flow so attribution stays consistent.
 *
 * Trust ladder:
 *  1. `cookie.recipientId` (token-verified, written server-side) → verify it belongs to `shareId`
 *     → source `"token"`.
 *  2. else `cookie.email` (self-declared form input) → match `shareId_email` (normalized
 *     lower/trim, exactly like recipient creation) → source `"self_declared"`.
 *  3. else → `null` (anonymous).
 *
 * This is a comfort feature, not a security control: a self-declared email is spoofable and that
 * is accepted — we never label a self-declared match as `"token"`.
 */
export async function resolveDownloadRecipient({
  shareId,
  cookie,
}: {
  shareId: string;
  cookie: ResolverCookie | undefined;
}): Promise<ResolvedDownloadRecipient | null> {
  if (!cookie) return null;

  // 1. Token-verified recipient id — vouched for server-side at access time.
  if (cookie.recipientId) {
    const recipient = await prisma.shareRecipient.findUnique({
      where: { id: cookie.recipientId },
      select: { id: true, shareId: true },
    });
    if (recipient && recipient.shareId === shareId) {
      return { recipientId: recipient.id, identificationSource: "token" };
    }
    // A recipientId that doesn't belong to this share is not trusted; fall through to email.
  }

  // 2. Self-declared email — match against this share's recipients (spoofable, labeled as such).
  if (cookie.email) {
    const email = cookie.email.trim().toLowerCase();
    if (email) {
      const recipient = await prisma.shareRecipient.findUnique({
        where: { shareId_email: { shareId, email } },
        select: { id: true },
      });
      if (recipient) {
        return { recipientId: recipient.id, identificationSource: "self_declared" };
      }
    }
  }

  // 3. Anonymous.
  return null;
}

/**
 * Resolve the download recipient straight from a Fastify request + shareId, handling the alias
 * lookup and cookie parse internally. Used by the audit-emit sites (lot F) which only have the
 * shareId in hand. Returns `null` for anonymous downloads, missing alias, or any lookup failure
 * (best-effort — audit metadata enrichment must never break a download).
 */
export async function resolveDownloadRecipientFromRequest(
  request: FastifyRequest,
  shareId: string,
): Promise<ResolvedDownloadRecipient | null> {
  try {
    const alias = await prisma.shareAlias.findUnique({
      where: { shareId },
      select: { alias: true },
    });
    if (!alias) return null;
    const cookie = parseVisitorCookie(request, alias.alias);
    return await resolveDownloadRecipient({ shareId, cookie });
  } catch {
    return null;
  }
}
