/**
 * LDAP filter injection regression tests (PF-S-M-8)
 *
 * The LdapClient uses structured filter classes (EqualityFilter, AndFilter) from
 * ldapts which perform RFC 4515 escaping internally. These tests verify that
 * special characters in LDAP filter values are properly escaped to prevent
 * LDAP injection attacks.
 */
import { AndFilter, EqualityFilter } from "ldapts";
import { describe, expect, it } from "vitest";

describe("LDAP filter injection regression (RFC 4515 escaping)", () => {
  /**
   * Helper: render an EqualityFilter with the given attribute+value to a string,
   * then return the value portion between "=" and ")".
   */
  function renderFilterValue(attribute: string, value: string): string {
    const filter = new EqualityFilter({ attribute, value });
    const rendered = filter.toString();
    // Format: (attribute=value)
    const eqIndex = rendered.indexOf("=");
    return rendered.slice(eqIndex + 1, -1); // strip trailing ")"
  }

  it("should escape asterisk (*) to \\2a", () => {
    expect(renderFilterValue("cn", "user*")).toBe("user\\2a");
  });

  it("should escape opening parenthesis (() to \\28", () => {
    expect(renderFilterValue("memberOf", "CN=group(A),DC=corp,DC=local")).toContain("\\28");
  });

  it("should escape closing parenthesis ()) to \\29", () => {
    expect(renderFilterValue("memberOf", "CN=group(A),DC=corp,DC=local")).toContain("\\29");
  });

  it("should escape backslash (\\) to \\5c", () => {
    expect(renderFilterValue("cn", "user\\admin")).toBe("user\\5cadmin");
  });

  it("should escape NUL byte (\\0) to \\00", () => {
    expect(renderFilterValue("cn", "user\x00name")).toBe("user\\00name");
  });

  it("should escape injection attempt: user)(cn=*)", () => {
    // A classic LDAP injection: closing the filter early and injecting a new one
    const escaped = renderFilterValue("cn", "user)(cn=*)");
    expect(escaped).toBe("user\\29\\28cn=\\2a\\29");
  });

  it("should not escape safe characters", () => {
    expect(renderFilterValue("sAMAccountName", "jdoe")).toBe("jdoe");
    expect(renderFilterValue("mail", "user@corp.local")).toBe("user@corp.local");
  });

  it("should escape combined special characters in a realistic DN value", () => {
    // syncGroupDn with special chars — should not be injectable
    const maliciousDn = "CN=Transfer (R&D)*,DC=corp,DC=local";
    const escaped = renderFilterValue("memberOf", maliciousDn);
    expect(escaped).not.toContain("(");
    expect(escaped).not.toContain(")");
    expect(escaped).not.toContain("*");
    expect(escaped).toContain("\\28");
    expect(escaped).toContain("\\29");
    expect(escaped).toContain("\\2a");
  });

  it("should produce a valid filter string from AndFilter with EqualityFilter", () => {
    const filter = new AndFilter({
      filters: [
        new EqualityFilter({ attribute: "objectClass", value: "user" }),
        new EqualityFilter({
          attribute: "memberOf",
          value: "CN=Admin*(Group),DC=corp,DC=local",
        }),
      ],
    });
    const rendered = filter.toString();
    // The special chars in the memberOf value must be escaped
    expect(rendered).toContain("\\2a"); // *
    expect(rendered).toContain("\\28"); // (
    expect(rendered).toContain("\\29"); // )
    // The objectClass value has no special chars and should be literal
    // Note: EqualityFilter preserves attribute case when constructed directly
    expect(rendered).toContain("(objectClass=user)");
  });
});
