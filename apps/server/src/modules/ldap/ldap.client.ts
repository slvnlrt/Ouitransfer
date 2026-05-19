import { Client } from "ldapts";

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
}

export interface LdapSearchConfig {
  searchBase: string;
  syncGroupDn: string;
  usernameAttribute: string;
  emailAttribute: string;
  displayNameAttribute: string;
}

export class LdapClient {
  private client: Client | null = null;

  async connect(config: LdapConnectionConfig): Promise<void> {
    this.client = new Client({
      url: config.serverUrl,
      tlsOptions: config.useTls ? { rejectUnauthorized: false } : undefined,
    });
    await this.client.bind(config.bindDn, config.bindPassword);
  }

  async searchSyncGroupMembers(config: LdapSearchConfig): Promise<LdapUserEntry[]> {
    if (!this.client) {
      throw new Error("LDAP client not connected");
    }

    const { searchEntries } = await this.client.search(config.searchBase, {
      scope: "sub",
      filter: `(&(objectClass=user)(objectCategory=person)(memberOf=${config.syncGroupDn}))`,
      attributes: [
        config.usernameAttribute,
        config.emailAttribute,
        config.displayNameAttribute,
        "distinguishedName",
        "memberOf",
      ],
    });

    return searchEntries.map((entry) => {
      const memberOf = entry.memberOf;
      const memberOfArray = Array.isArray(memberOf)
        ? memberOf.map(String)
        : memberOf
          ? [String(memberOf)]
          : [];

      return {
        dn: String(entry.distinguishedName || entry.dn),
        username: String(entry[config.usernameAttribute] || ""),
        email: String(entry[config.emailAttribute] || ""),
        displayName: String(entry[config.displayNameAttribute] || ""),
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
