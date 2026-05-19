import { AndFilter, Client, EqualityFilter } from "ldapts";
import { AppError } from "../../utils/app-error.js";

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
    await this.client.bind(config.bindDn, config.bindPassword);
  }

  async searchSyncGroupMembers(config: LdapSearchConfig): Promise<LdapUserEntry[]> {
    if (!this.client) {
      throw new AppError(500, "LDAP client not connected", "LDAP_CLIENT_NOT_CONNECTED");
    }

    // Use structured filter classes to prevent LDAP injection (RFC 4515 escaping)
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
