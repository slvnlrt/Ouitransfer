import type { FastifyRequest } from "fastify";
import { z } from "zod";

/** Zod schema for the signed visitor identification cookie payload. */
const VisitorCookiePayload = z.object({
  alias: z.string(),
  name: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  // recipientId is written ONLY server-side after a tracking token is verified at access
  // time — never from form input. Its presence vouches for a token-verified recipient, so
  // a download that reads it back can be labeled `identificationSource: "token"`.
  recipientId: z.string().nullable().optional(),
});

/** Parsed visitor identity returned by {@link parseVisitorCookie}. */
export interface VisitorIdentity {
  alias: string;
  name?: string;
  email?: string;
  /** Token-verified recipient id, set server-side at access time. Absent for self-declared visitors. */
  recipientId?: string;
}

/**
 * Parse a signed visitor identification cookie for the given share alias.
 * Returns the parsed payload if valid, undefined otherwise.
 *
 * The cookie name is `sv_{alias}` and contains a signed JSON payload
 * set by the share access identification flow.
 */
export function parseVisitorCookie(
  request: FastifyRequest,
  alias: string,
): VisitorIdentity | undefined {
  const raw = request.cookies[`sv_${alias}`];
  if (!raw) return undefined;
  const unsigned = request.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return undefined;
  try {
    const parsed = VisitorCookiePayload.safeParse(JSON.parse(unsigned.value));
    if (!parsed.success) return undefined;
    const payload = parsed.data;
    if (payload.alias !== alias) return undefined;
    // Treat empty-content cookies as absent — name/email/recipientId all blank is the same
    // as no identification.
    if (!payload.name && !payload.email && !payload.recipientId) return undefined;
    return {
      alias: payload.alias,
      name: payload.name ?? undefined,
      email: payload.email ?? undefined,
      recipientId: payload.recipientId ?? undefined,
    };
  } catch (err) {
    request.log.debug({ err, alias }, "Failed to parse visitor identification cookie");
    return undefined;
  }
}

/**
 * Serialize a signed visitor identification cookie payload (the JSON value passed to
 * `reply.setCookie`). Centralizes the payload shape so every writer — the identification
 * form and the access-time recipientId refresh — stays symmetric with {@link parseVisitorCookie}.
 */
export function buildVisitorCookiePayload(identity: {
  alias: string;
  name?: string | null;
  email?: string | null;
  recipientId?: string | null;
}): string {
  return JSON.stringify({
    alias: identity.alias,
    name: identity.name ?? null,
    email: identity.email ?? null,
    recipientId: identity.recipientId ?? null,
  });
}
