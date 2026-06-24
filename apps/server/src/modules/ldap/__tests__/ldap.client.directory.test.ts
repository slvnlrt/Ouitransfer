/**
 * Unit tests for the LdapClient directory-browser methods
 * (readRootDse / browseContainers / searchGroups).
 *
 * The ldapts `Client` is mocked so we can capture the search base + options and
 * assert on the constructed filter OBJECTS (never strings) and sizeLimit caps.
 * The real ldapts filter classes are kept (only `Client` is replaced), so the
 * C-1 assertion exercises the genuine SubstringFilter type.
 */

import {
  AndFilter,
  EqualityFilter,
  type Filter,
  OrFilter,
  PresenceFilter,
  SubstringFilter,
} from "ldapts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  getLogger: vi.fn(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() })),
}));

// Capture the args of every search() call. A single mock instance is shared so
// each test can inspect / drive the search behavior.
const searchMock = vi.fn();
const bindMock = vi.fn();
const unbindMock = vi.fn();

vi.mock("ldapts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ldapts")>();
  return {
    ...actual,
    Client: class MockClient {
      bind = bindMock;
      unbind = unbindMock;
      search = searchMock;
    },
  };
});

// Imported AFTER the mock is registered.
const { LdapClient } = await import("../ldap.client.js");
const { BROWSE_SIZE_LIMIT, GROUP_SEARCH_SIZE_LIMIT } = await import("../constants.js");

/** Connect a client against the mocked ldapts Client (skips real SSRF/network). */
async function connectedClient(): Promise<InstanceType<typeof LdapClient>> {
  const client = new LdapClient();
  await client.connect({
    serverUrl: "ldap://dc.corp.local",
    bindDn: "CN=svc,DC=corp,DC=local",
    bindPassword: "secret",
    useTls: false,
  });
  return client;
}

beforeEach(() => {
  searchMock.mockReset();
  bindMock.mockReset();
  unbindMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("LdapClient.readRootDse", () => {
  it("reads namingContexts + defaultNamingContext with a base-scope presence filter", async () => {
    searchMock.mockResolvedValue({
      searchEntries: [
        {
          dn: "",
          namingContexts: ["DC=corp,DC=local", "CN=Configuration,DC=corp,DC=local"],
          defaultNamingContext: "DC=corp,DC=local",
        },
      ],
    });

    const client = await connectedClient();
    const result = await client.readRootDse();

    expect(result.namingContexts).toEqual([
      "DC=corp,DC=local",
      "CN=Configuration,DC=corp,DC=local",
    ]);
    expect(result.defaultNamingContext).toBe("DC=corp,DC=local");

    const [base, options] = searchMock.mock.calls[0];
    expect(base).toBe("");
    expect(options.scope).toBe("base");
    expect(options.filter).toBeInstanceOf(PresenceFilter);
    expect(options.attributes).toEqual(["namingContexts", "defaultNamingContext"]);
  });

  it("drops empty-string naming contexts (rootDSE '' entry)", async () => {
    searchMock.mockResolvedValue({
      searchEntries: [
        {
          dn: "",
          namingContexts: ["", "dc=example,dc=org"],
        },
      ],
    });

    const client = await connectedClient();
    const result = await client.readRootDse();

    expect(result.namingContexts).toEqual(["dc=example,dc=org"]);
  });

  it("returns defaultNamingContext = null for non-AD servers (attribute absent)", async () => {
    searchMock.mockResolvedValue({
      searchEntries: [
        {
          dn: "",
          namingContexts: ["dc=example,dc=org"],
        },
      ],
    });

    const client = await connectedClient();
    const result = await client.readRootDse();

    expect(result.defaultNamingContext).toBeNull();
  });

  it("handles an empty RootDSE response without throwing", async () => {
    searchMock.mockResolvedValue({ searchEntries: [] });

    const client = await connectedClient();
    const result = await client.readRootDse();

    expect(result).toEqual({ namingContexts: [], defaultNamingContext: null });
  });
});

describe("LdapClient.browseContainers", () => {
  it("uses scope=one, an OrFilter of objectClass EqualityFilters, and the size cap", async () => {
    searchMock.mockResolvedValue({ searchEntries: [] });

    const client = await connectedClient();
    await client.browseContainers("DC=corp,DC=local");

    const [base, options] = searchMock.mock.calls[0];
    expect(base).toBe("DC=corp,DC=local");
    expect(options.scope).toBe("one");
    expect(options.sizeLimit).toBe(BROWSE_SIZE_LIMIT);
    expect(options.attributes).toEqual(["ou", "cn", "name", "objectClass"]);

    const filter = options.filter as OrFilter;
    expect(filter).toBeInstanceOf(OrFilter);
    const objectClasses = filter.filters.map((f) => (f as EqualityFilter).value);
    expect(objectClasses).toEqual([
      "organizationalUnit",
      "container",
      "domainDNS",
      "builtinDomain",
    ]);
    for (const f of filter.filters) {
      expect(f).toBeInstanceOf(EqualityFilter);
      expect((f as EqualityFilter).attribute).toBe("objectClass");
    }
  });

  it("maps AD-shaped entries to nodes with the right type and sorts by name", async () => {
    searchMock.mockResolvedValue({
      searchEntries: [
        {
          dn: "OU=Sales,DC=corp,DC=local",
          ou: "Sales",
          objectClass: ["top", "organizationalUnit"],
        },
        { dn: "CN=Users,DC=corp,DC=local", cn: "Users", objectClass: ["top", "container"] },
        {
          dn: "CN=Builtin,DC=corp,DC=local",
          cn: "Builtin",
          objectClass: ["top", "builtinDomain"],
        },
        {
          dn: "OU=Engineering,DC=corp,DC=local",
          ou: "Engineering",
          objectClass: ["organizationalUnit"],
        },
      ],
    });

    const client = await connectedClient();
    const nodes = await client.browseContainers("DC=corp,DC=local");

    // Sorted by name (case-insensitive): Builtin, Engineering, Sales, Users
    expect(nodes.map((n) => n.name)).toEqual(["Builtin", "Engineering", "Sales", "Users"]);
    expect(nodes.every((n) => n.hasChildren)).toBe(true);

    const byName = Object.fromEntries(nodes.map((n) => [n.name, n]));
    expect(byName.Sales.type).toBe("ou");
    expect(byName.Engineering.type).toBe("ou");
    expect(byName.Users.type).toBe("container");
    expect(byName.Builtin.type).toBe("container");
  });

  it("derives the domain type for a domainDNS root and falls back to its dn for name", async () => {
    searchMock.mockResolvedValue({
      searchEntries: [{ dn: "DC=sub,DC=corp,DC=local", objectClass: ["top", "domainDNS"] }],
    });

    const client = await connectedClient();
    const nodes = await client.browseContainers("DC=corp,DC=local");

    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe("domain");
    expect(nodes[0].name).toBe("DC=sub,DC=corp,DC=local");
  });
});

describe("LdapClient.searchGroups", () => {
  it("composes AndFilter(objectClass=group, OrFilter(cn|sAMAccountName substring)) with the cap", async () => {
    searchMock.mockResolvedValue({ searchEntries: [] });

    const client = await connectedClient();
    await client.searchGroups("DC=corp,DC=local", "admins");

    const [base, options] = searchMock.mock.calls[0];
    expect(base).toBe("DC=corp,DC=local");
    expect(options.scope).toBe("sub");
    expect(options.sizeLimit).toBe(GROUP_SEARCH_SIZE_LIMIT);
    expect(options.attributes).toEqual(["cn", "name"]);

    const filter = options.filter as AndFilter;
    expect(filter).toBeInstanceOf(AndFilter);
    const [eq, or] = filter.filters as [EqualityFilter, OrFilter];
    expect(eq).toBeInstanceOf(EqualityFilter);
    expect(eq.attribute).toBe("objectClass");
    expect(eq.value).toBe("group");
    expect(or).toBeInstanceOf(OrFilter);

    const subs = or.filters as SubstringFilter[];
    expect(subs.map((s) => s.attribute)).toEqual(["cn", "sAMAccountName"]);
    for (const s of subs) {
      expect(s).toBeInstanceOf(SubstringFilter);
      expect(s.any).toEqual(["admins"]);
    }
  });

  it("maps group entries to leaf nodes using entry.dn for the dn", async () => {
    searchMock.mockResolvedValue({
      searchEntries: [{ dn: "CN=Admins,DC=corp,DC=local", cn: "Admins" }],
    });

    const client = await connectedClient();
    const { groups, truncated } = await client.searchGroups("DC=corp,DC=local", "adm");

    expect(truncated).toBe(false);
    expect(groups).toEqual([
      {
        dn: "CN=Admins,DC=corp,DC=local",
        name: "Admins",
        type: "group",
        hasChildren: false,
      },
    ]);
  });

  it("uses entry.dn on non-AD servers where distinguishedName is absent ([] → not ''))", async () => {
    // ldapts sets any requested-but-absent attribute to [] (truthy → String([])
    // = ""). On OpenLDAP/389-DS the AD-specific distinguishedName is [], so the
    // group dn must come from entry.dn, never an empty string.
    searchMock.mockResolvedValue({
      searchEntries: [{ dn: "cn=admins,dc=corp,dc=local", cn: "admins", distinguishedName: [] }],
    });

    const client = await connectedClient();
    const { groups } = await client.searchGroups("dc=corp,dc=local", "adm");

    expect(groups[0]?.dn).toBe("cn=admins,dc=corp,dc=local");
    expect(groups[0]?.dn).not.toBe("");
  });

  it("reports truncated=true when the result reaches the size cap", async () => {
    const entries = Array.from({ length: GROUP_SEARCH_SIZE_LIMIT }, (_, i) => ({
      dn: `CN=Group${i},DC=corp,DC=local`,
      cn: `Group${i}`,
    }));
    searchMock.mockResolvedValue({ searchEntries: entries });

    const client = await connectedClient();
    const { groups, truncated } = await client.searchGroups("DC=corp,DC=local", "group");

    expect(groups).toHaveLength(GROUP_SEARCH_SIZE_LIMIT);
    expect(truncated).toBe(true);
  });

  it("treats a thrown SizeLimitExceededError as truncated (defense-in-depth)", async () => {
    const err = new Error("size limit exceeded");
    err.name = "SizeLimitExceededError";
    searchMock.mockRejectedValue(err);

    const client = await connectedClient();
    const { groups, truncated } = await client.searchGroups("DC=corp,DC=local", "group");

    expect(groups).toEqual([]);
    expect(truncated).toBe(true);
  });

  // ── C-1: filter-injection regression ───────────────────────────────────────
  it("carries a metacharacter-laden query as a SubstringFilter VALUE, never a filter string", async () => {
    searchMock.mockResolvedValue({ searchEntries: [] });

    const malicious = "*()\\";
    const client = await connectedClient();
    await client.searchGroups("DC=corp,DC=local", malicious);

    const [, options] = searchMock.mock.calls[0];

    // The filter passed to ldapts is an OBJECT, not a string — ldapts only
    // BER-encodes/escapes filter objects; a filter passed as a string would be
    // parsed by FilterParser where * ( ) \ are syntax.
    expect(typeof options.filter).not.toBe("string");
    expect(options.filter).toBeInstanceOf(AndFilter);

    const or = (options.filter as AndFilter).filters[1] as OrFilter;
    const subs = or.filters as SubstringFilter[];

    // The raw query is carried verbatim as the substring `any` value — it is data,
    // not parsed syntax. Both attribute branches hold the untouched query.
    for (const s of subs) {
      expect(s).toBeInstanceOf(SubstringFilter);
      expect(s.any).toEqual([malicious]);
    }
  });

  // Type guard so the `Filter` import is exercised and the cast above is sound.
  it("constructs only ldapts Filter instances (no string filters)", async () => {
    searchMock.mockResolvedValue({ searchEntries: [] });
    const client = await connectedClient();
    await client.searchGroups("DC=corp,DC=local", "x");
    const [, options] = searchMock.mock.calls[0];
    const filter: Filter = options.filter;
    expect(filter).toBeInstanceOf(AndFilter);
  });
});
