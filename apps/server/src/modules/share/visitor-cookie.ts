import type { FastifyRequest } from "fastify";
import { z } from "zod";

/** Zod schema for the signed visitor identification cookie payload. */
const VisitorCookiePayload = z.object({
  alias: z.string(),
  name: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
});

/** Parsed visitor identity returned by {@link parseVisitorCookie}. */
export interface VisitorIdentity {
  alias: string;
  name?: string;
  email?: string;
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
    // Treat empty-content cookies as absent — both fields blank is the same as no identification
    if (!payload.name && !payload.email) return undefined;
    return {
      alias: payload.alias,
      name: payload.name ?? undefined,
      email: payload.email ?? undefined,
    };
  } catch (err) {
    request.log.debug({ err, alias }, "Failed to parse visitor identification cookie");
    return undefined;
  }
}
