import { AndFilter, Client, EqualityFilter } from "ldapts";
import { AppError } from "../../utils/app-error.js";
import { getLogger } from "../../utils/logger.js";

// RFC 4512 §2.5: attributeType = ALPHA *( ALPHA / DIGIT / "-" )
const LDAP_ATTR_RE = /^[A-Za-z][A-Za-z0-9-]*$/;

/**
 * Defense-in-depth guard against attribute enumeration via injected attribute names.
 * Zod schemas enforce this at the API boundary; this catches any bypass path (e.g. DB corruption).
 */
export function assertSafeAttributeName(name: string): void {
  if (!LDAP_ATTR_RE.test(name)) {
    getLogger().warn({ attributeName: name }, "Rejected invalid LDAP attribute name");
    throw new AppError(400, "Invalid LDAP attribute name", "LDAP_INVALID_ATTRIBUTE_NAME");
  }
}

export interface LdapUserEntry {
  dn: string;
  username: string;
  email: string;
  displayName: string;
  memberOf: string[];
}

export interface LdapConnectionConfig {
  serverUrl: string;
  bindDn: string;
  bindPassword: string;
  useTls: boolean;
  tlsSkipVerify?: boolean;
}

export interface LdapSearchConfig {
  searchBase: string;
  syncGroupDn: string;
  usernameAttribute: string;
  emailAttribute: string;
  displayNameAttribute: string;
}

/**
 * Get the value of an LDAP attribute from an entry, using case-insensitive lookup.
 * LDAP attributes are case-insensitive per RFC 4512.
 */
function getEntryAttribute(entry: Record<string, unknown>, attribute: string): string {
  const lowerAttr = attribute.toLowerCase();
  for (const key of Object.keys(entry)) {
    if (key.toLowerCase() === lowerAttr) {
      return String(entry[key] || "");
    }
  }
  return "";
}

export class LdapClient {
  private client: Client | null = null;

  async connect(config: LdapConnectionConfig): Promise<void> {
    this.client = new Client({
      url: config.serverUrl,
      tlsOptions: config.useTls ? { rejectUnauthorized: !config.tlsSkipVerify } : undefined,
    });
    // SAST false positive: bind args are credentials, not a filter — not an injection sink.
    await this.client.bind(config.bindDn, config.bindPassword);
  }

  async searchSyncGroupMembers(config: LdapSearchConfig): Promise<LdapUserEntry[]> {
    if (!this.client) {
      throw new AppError(500, "LDAP client not connected", "LDAP_CLIENT_NOT_CONNECTED");
    }

    // Reject attribute names that don't conform to RFC 4512 (defense-in-depth;
    // the API boundary already enforces this via Zod).
    assertSafeAttributeName(config.usernameAttribute);
    assertSafeAttributeName(config.emailAttribute);
    assertSafeAttributeName(config.displayNameAttribute);

    // Filter values are escaped by ldapts (RFC 4515). searchBase is a base DN,
    // not a filter value — it isn't escaped, but also isn't injectable into a filter.
    const filter = new AndFilter({
      filters: [
        new EqualityFilter({ attribute: "objectClass", value: "user" }),
        new EqualityFilter({ attribute: "objectCategory", value: "person" }),
        new EqualityFilter({ attribute: "memberOf", value: config.syncGroupDn }),
      ],
    });

    const { searchEntries } = await this.client.search(config.searchBase, {
      scope: "sub",
      filter,
      attributes: [
        config.usernameAttribute,
        config.emailAttribute,
        config.displayNameAttribute,
        "distinguishedName",
        "memberOf",
      ],
    });

    return searchEntries.map((entry) => {
      const entryRecord = entry as unknown as Record<string, unknown>;
      const memberOf = entry.memberOf;
      const memberOfArray = Array.isArray(memberOf)
        ? memberOf.map(String)
        : memberOf
          ? [String(memberOf)]
          : [];

      return {
        dn: String(entry.distinguishedName || entry.dn),
        username: getEntryAttribute(entryRecord, config.usernameAttribute),
        email: getEntryAttribute(entryRecord, config.emailAttribute),
        displayName: getEntryAttribute(entryRecord, config.displayNameAttribute),
        memberOf: memberOfArray,
      };
    });
  }

  async testConnection(
    config: LdapConnectionConfig & LdapSearchConfig,
  ): Promise<{ success: boolean; memberCount: number; message: string }> {
    try {
      await this.connect(config);
      const members = await this.searchSyncGroupMembers(config);
      return {
        success: true,
        memberCount: members.length,
        message: `Connected successfully. Found ${members.length} members in sync group.`,
      };
    } catch (error) {
      return {
        success: false,
        memberCount: 0,
        message: error instanceof Error ? error.message : "Unknown error",
      };
    } finally {
      await this.disconnect();
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.unbind();
      } catch {
        // Ignore unbind errors during cleanup
      }
      this.client = null;
    }
  }
}
