/**
 * Shared LDAP module constants.
 */

/**
 * Placeholder rendered in place of the stored bind password whenever it is sent
 * to the client (GET/PUT /admin/ldap/config). On the way back in, a body that
 * still holds this masked value (or an empty string) means "reuse the stored
 * encrypted password" — see {@link resolveBindPassword} and the PUT /config rule.
 */
export const MASKED_PASSWORD = "••••••••";

/**
 * Upper bound on container entries returned by a single directory-browse call.
 * Caps the response so a hostile/huge directory cannot dump unbounded data.
 */
export const BROWSE_SIZE_LIMIT = 200;

/**
 * Upper bound on group entries returned by a single group-search call. When the
 * search reaches this cap, the route reports `truncated: true` so the UI can
 * prompt the admin to refine the query.
 */
export const GROUP_SEARCH_SIZE_LIMIT = 50;
