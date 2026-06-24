import {
  AndFilter,
  Client,
  EqualityFilter,
  OrFilter,
  PresenceFilter,
  SubstringFilter,
} from "ldapts";
import { AppError } from "../../utils/app-error.js";
import { getLogger } from "../../utils/logger.js";
import { BROWSE_SIZE_LIMIT, GROUP_SEARCH_SIZE_LIMIT } from "./constants.js";
import { assertLdapTargetAllowed } from "./ldap-ssrf.js";

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

/**
 * A node in the directory tree returned by the browse/search endpoints.
 * `type` drives the tree icon; `hasChildren` controls whether an expand
 * affordance is shown without a separate child-count probe.
 */
export interface LdapDirectoryNode {
  dn: string;
  name: string;
  type: "ou" | "container" | "domain" | "group";
  hasChildren: boolean;
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

/**
 * Read an LDAP attribute as a string array, using case-insensitive lookup.
 * Multi-valued attributes (e.g. objectClass) come back as arrays; single-valued
 * ones as scalars. Normalizes both to a string[].
 */
function getEntryAttributeValues(entry: Record<string, unknown>, attribute: string): string[] {
  const lowerAttr = attribute.toLowerCase();
  for (const key of Object.keys(entry)) {
    if (key.toLowerCase() === lowerAttr) {
      const value = entry[key];
      if (Array.isArray(value)) return value.map(String);
      if (value === undefined || value === null || value === "") return [];
      return [String(value)];
    }
  }
  return [];
}

/**
 * Container object classes that the browser navigates into, mapped to the node
 * `type` that drives the tree icon. Order matters: organizationalUnit is the
 * most specific/common, checked first.
 */
const CONTAINER_OBJECT_CLASSES: { objectClass: string; type: LdapDirectoryNode["type"] }[] = [
  { objectClass: "organizationalUnit", type: "ou" },
  { objectClass: "container", type: "container" },
  { objectClass: "domainDNS", type: "domain" },
  { objectClass: "builtinDomain", type: "container" },
];

/**
 * Derive a container node `type` from an entry's objectClass values. Falls back
 * to "container" when none of the known container classes is present (the entry
 * still matched the browse filter, so it is a container of some kind).
 */
function deriveContainerType(objectClasses: string[]): LdapDirectoryNode["type"] {
  const lowered = new Set(objectClasses.map((c) => c.toLowerCase()));
  for (const { objectClass, type } of CONTAINER_OBJECT_CLASSES) {
    if (lowered.has(objectClass.toLowerCase())) return type;
  }
  return "container";
}

export class LdapClient {
  private client: Client | null = null;

  async connect(config: LdapConnectionConfig): Promise<void> {
    // Egress (SSRF) + transport-confidentiality guard (A5-05, A5-07, A5-11).
    // Validates the scheme, blocks cloud-metadata hosts (and enforces
    // LDAP_ALLOWED_HOSTS when set), and warns on weak transport — before any
    // socket opens. The admin's useTls/tlsSkipVerify/scheme are honored as-is.
    assertLdapTargetAllowed({
      serverUrl: config.serverUrl,
      useTls: config.useTls,
      tlsSkipVerify: config.tlsSkipVerify,
    });

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

  /**
   * Read the RootDSE to auto-detect browsable bases.
   *
   * `namingContexts` lists the directory's naming contexts (browsable roots);
   * empty-string contexts (the rootDSE "" entry some servers expose) are dropped
   * because they are not a valid base to pick. `defaultNamingContext` is
   * Microsoft-AD-specific and is `null` on OpenLDAP / 389-DS / FreeIPA.
   */
  async readRootDse(): Promise<{
    namingContexts: string[];
    defaultNamingContext: string | null;
  }> {
    if (!this.client) {
      throw new AppError(500, "LDAP client not connected", "LDAP_CLIENT_NOT_CONNECTED");
    }

    const { searchEntries } = await this.client.search("", {
      scope: "base",
      filter: new PresenceFilter({ attribute: "objectClass" }),
      attributes: ["namingContexts", "defaultNamingContext"],
    });

    const entry = (searchEntries[0] ?? {}) as Record<string, unknown>;

    const namingContexts = getEntryAttributeValues(entry, "namingContexts").filter(
      (nc) => nc.length > 0,
    );
    const defaultNamingContexts = getEntryAttributeValues(entry, "defaultNamingContext").filter(
      (nc) => nc.length > 0,
    );

    return {
      namingContexts,
      defaultNamingContext: defaultNamingContexts[0] ?? null,
    };
  }

  /**
   * List the immediate container children of `baseDn` (one level), so the admin
   * can drill into OUs/containers. Returns container-type nodes sorted by name.
   */
  async browseContainers(baseDn: string): Promise<LdapDirectoryNode[]> {
    if (!this.client) {
      throw new AppError(500, "LDAP client not connected", "LDAP_CLIENT_NOT_CONNECTED");
    }

    // Composed as filter objects (never a filter string): ldapts BER-encodes the
    // EqualityFilter values safely. The objectClass set covers user OUs
    // (organizationalUnit) and AD well-known containers (CN=Users/CN=Computers →
    // container, CN=Builtin → builtinDomain), plus the domain root (domainDNS).
    const filter = new OrFilter({
      filters: [
        new EqualityFilter({ attribute: "objectClass", value: "organizationalUnit" }),
        new EqualityFilter({ attribute: "objectClass", value: "container" }),
        new EqualityFilter({ attribute: "objectClass", value: "domainDNS" }),
        new EqualityFilter({ attribute: "objectClass", value: "builtinDomain" }),
      ],
    });

    const { searchEntries } = await this.client.search(baseDn, {
      scope: "one",
      filter,
      attributes: ["ou", "cn", "name", "objectClass"],
      sizeLimit: BROWSE_SIZE_LIMIT,
    });

    const nodes: LdapDirectoryNode[] = searchEntries.map((entry) => {
      const record = entry as unknown as Record<string, unknown>;
      const name =
        getEntryAttribute(record, "ou") ||
        getEntryAttribute(record, "cn") ||
        getEntryAttribute(record, "name") ||
        String(entry.dn);
      return {
        dn: String(entry.dn),
        name,
        type: deriveContainerType(getEntryAttributeValues(record, "objectClass")),
        hasChildren: true,
      };
    });

    nodes.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    return nodes;
  }

  /**
   * Search for groups under `searchBase` whose cn or sAMAccountName contains the
   * query substring.
   *
   * C-1: the query is carried ONLY as a SubstringFilter value (a filter object),
   * never interpolated into a filter string. ldapts BER-encodes the substring
   * value, so filter metacharacters (`* ( ) \`) in the query are data, not
   * syntax. `truncated` is true when the result reaches the size cap.
   */
  async searchGroups(
    searchBase: string,
    query: string,
  ): Promise<{ groups: LdapDirectoryNode[]; truncated: boolean }> {
    if (!this.client) {
      throw new AppError(500, "LDAP client not connected", "LDAP_CLIENT_NOT_CONNECTED");
    }

    const filter = new AndFilter({
      filters: [
        new EqualityFilter({ attribute: "objectClass", value: "group" }),
        new OrFilter({
          filters: [
            new SubstringFilter({ attribute: "cn", any: [query] }),
            new SubstringFilter({ attribute: "sAMAccountName", any: [query] }),
          ],
        }),
      ],
    });

    let searchEntries: Awaited<ReturnType<Client["search"]>>["searchEntries"];
    let truncated = false;
    try {
      ({ searchEntries } = await this.client.search(searchBase, {
        scope: "sub",
        filter,
        attributes: ["cn", "name", "distinguishedName"],
        sizeLimit: GROUP_SEARCH_SIZE_LIMIT,
      }));
    } catch (error) {
      // With a sizeLimit set, ldapts returns the partial result instead of
      // throwing; this catch is defense-in-depth for servers/versions that
      // surface SizeLimitExceeded as an error — treat it as truncated with no
      // entries rather than leaking the raw error.
      if (error instanceof Error && error.name === "SizeLimitExceededError") {
        return { groups: [], truncated: true };
      }
      throw error;
    }

    if (searchEntries.length >= GROUP_SEARCH_SIZE_LIMIT) {
      truncated = true;
    }

    const groups: LdapDirectoryNode[] = searchEntries.map((entry) => {
      const record = entry as unknown as Record<string, unknown>;
      const name =
        getEntryAttribute(record, "cn") ||
        getEntryAttribute(record, "name") ||
        String(entry.distinguishedName || entry.dn);
      return {
        dn: String(entry.distinguishedName || entry.dn),
        name,
        type: "group",
        hasChildren: false,
      };
    });

    return { groups, truncated };
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
      // Surface only our own configuration-validation errors (scheme / SSRF /
      // transport policy — LDAP_* codes from assertLdapTargetAllowed and the
      // attribute-name guard). These are safe, actionable config feedback.
      //
      // Never surface the raw connection/bind/search error string: it is a
      // port-scan / topology oracle (A5-11) — distinct failure modes (connection
      // refused vs. TLS handshake vs. bad credentials) reveal internal network
      // state. Log it server-side, return a generic message to the caller.
      if (error instanceof AppError && error.code?.startsWith("LDAP_")) {
        return { success: false, memberCount: 0, message: error.message };
      }
      getLogger().warn(
        { err: error instanceof Error ? error.message : "unknown" },
        "LDAP test connection failed",
      );
      return {
        success: false,
        memberCount: 0,
        message: "Connection failed. Check the server URL, credentials, and network reachability.",
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
