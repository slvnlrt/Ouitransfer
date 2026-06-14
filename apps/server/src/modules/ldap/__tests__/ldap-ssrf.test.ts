/**
 * ldap-ssrf.test.ts — egress (SSRF) + transport-confidentiality guard for the
 * LDAP client (A5-05, A5-07, A5-11).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  getLogger: vi.fn(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() })),
}));

import { AppError } from "../../../utils/app-error.js";
import { assertLdapTargetAllowed } from "../ldap-ssrf.js";

const REMOTE_LDAPS = { serverUrl: "ldaps://ad.corp.example:636", useTls: true };

describe("assertLdapTargetAllowed — egress (SSRF)", () => {
  beforeEach(() => vi.unstubAllEnvs());
  afterEach(() => vi.unstubAllEnvs());

  it("rejects the cloud metadata endpoint even via ldaps", () => {
    expect(() =>
      assertLdapTargetAllowed({ serverUrl: "ldaps://169.254.169.254", useTls: true }),
    ).toThrow(AppError);
    expect(() =>
      assertLdapTargetAllowed({ serverUrl: "ldaps://169.254.169.254", useTls: true }),
    ).toThrow(/not permitted|metadata/i);
  });

  it("rejects loopback hosts by default", () => {
    expect(() =>
      assertLdapTargetAllowed({ serverUrl: "ldaps://127.0.0.1:636", useTls: true }),
    ).toThrow(/LDAP_HOST_NOT_ALLOWED|not permitted/i);
    expect(() =>
      assertLdapTargetAllowed({ serverUrl: "ldaps://localhost:636", useTls: true }),
    ).toThrow(AppError);
  });

  it("rejects private RFC1918 hosts by default", () => {
    expect(() =>
      assertLdapTargetAllowed({ serverUrl: "ldaps://10.0.0.5:636", useTls: true }),
    ).toThrow(AppError);
    expect(() =>
      assertLdapTargetAllowed({ serverUrl: "ldaps://192.168.1.10:636", useTls: true }),
    ).toThrow(AppError);
  });

  it("rejects a non-ldap scheme", () => {
    expect(() =>
      assertLdapTargetAllowed({ serverUrl: "http://ad.corp.example", useTls: true }),
    ).toThrow(/scheme/i);
  });

  it("rejects an unparseable URL", () => {
    expect(() => assertLdapTargetAllowed({ serverUrl: "not a url", useTls: true })).toThrow(
      /Invalid LDAP server URL/i,
    );
  });

  it("allows a normal public ldaps host", () => {
    expect(() => assertLdapTargetAllowed(REMOTE_LDAPS)).not.toThrow();
  });

  it("allows a private host when LDAP_ALLOW_PRIVATE_HOST=true (opt-in)", async () => {
    vi.stubEnv("LDAP_ALLOW_PRIVATE_HOST", "true");
    vi.resetModules();
    const mod = await import("../ldap-ssrf.js");
    // Private + ldaps → allowed by the opt-in, transport already encrypted.
    expect(() =>
      mod.assertLdapTargetAllowed({ serverUrl: "ldaps://192.168.1.10:636", useTls: true }),
    ).not.toThrow();
    // Private + cleartext ldap:// is allowed (private/loopback is treated as a
    // trusted LAN for the transport policy).
    expect(() =>
      mod.assertLdapTargetAllowed({ serverUrl: "ldap://192.168.1.10:389", useTls: false }),
    ).not.toThrow();
    // Metadata still blocked even with the opt-in.
    const m = await import("../../../utils/app-error.js");
    expect(() =>
      mod.assertLdapTargetAllowed({ serverUrl: "ldaps://169.254.169.254", useTls: true }),
    ).toThrow(m.AppError);
    vi.resetModules();
  });

  it("allows an exact host via LDAP_ALLOWED_HOSTS", async () => {
    vi.stubEnv("LDAP_ALLOWED_HOSTS", "10.0.0.9");
    vi.resetModules();
    const mod = await import("../ldap-ssrf.js");
    expect(() =>
      mod.assertLdapTargetAllowed({ serverUrl: "ldaps://10.0.0.9:636", useTls: true }),
    ).not.toThrow();
    vi.resetModules();
  });
});

describe("assertLdapTargetAllowed — transport confidentiality (A5-07)", () => {
  beforeEach(() => vi.unstubAllEnvs());
  afterEach(() => vi.unstubAllEnvs());

  it("rejects cleartext ldap:// to a remote host (no StartTLS)", () => {
    expect(() =>
      assertLdapTargetAllowed({ serverUrl: "ldap://ad.corp.example:389", useTls: false }),
    ).toThrow(/cleartext|LDAP_CLEARTEXT_REMOTE/i);
  });

  it("allows ldap:// to a remote host when StartTLS (useTls) is enabled", () => {
    expect(() =>
      assertLdapTargetAllowed({ serverUrl: "ldap://ad.corp.example:389", useTls: true }),
    ).not.toThrow();
  });

  it("allows ldaps:// to a remote host without StartTLS (implicit TLS)", () => {
    expect(() =>
      assertLdapTargetAllowed({ serverUrl: "ldaps://ad.corp.example:636", useTls: false }),
    ).not.toThrow();
  });

  it("forbids tlsSkipVerify for a remote host", () => {
    expect(() =>
      assertLdapTargetAllowed({
        serverUrl: "ldaps://ad.corp.example:636",
        useTls: true,
        tlsSkipVerify: true,
      }),
    ).toThrow(/tlsSkipVerify|LDAP_SKIP_VERIFY_REMOTE/i);
  });
});
