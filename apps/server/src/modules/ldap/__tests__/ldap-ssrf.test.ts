/**
 * ldap-ssrf.test.ts — egress (SSRF) + transport-confidentiality guard for the
 * LDAP client (A5-05, A5-07, A5-11).
 *
 * Policy (owner-decided): block only cloud-metadata hosts by default;
 * private/remote hosts are the admin's choice. LDAP_ALLOWED_HOSTS is an optional
 * exact-host lockdown. Weak transport (cleartext remote bind, tlsSkipVerify) is
 * WARNED, never blocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const warn = vi.fn();

vi.mock("../../../utils/logger.js", () => ({
  getLogger: vi.fn(() => ({ warn, error: vi.fn(), info: vi.fn(), debug: vi.fn() })),
}));

import { AppError } from "../../../utils/app-error.js";
import { assertLdapTargetAllowed } from "../ldap-ssrf.js";

const REMOTE_LDAPS = { serverUrl: "ldaps://ad.corp.example:636", useTls: true };

describe("assertLdapTargetAllowed — egress (SSRF)", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    warn.mockClear();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("rejects the cloud metadata endpoint even via ldaps", () => {
    expect(() =>
      assertLdapTargetAllowed({ serverUrl: "ldaps://169.254.169.254", useTls: true }),
    ).toThrow(AppError);
    expect(() =>
      assertLdapTargetAllowed({ serverUrl: "ldaps://169.254.169.254", useTls: true }),
    ).toThrow(/not permitted|metadata/i);
  });

  it("rejects the metadata DNS alias", () => {
    expect(() =>
      assertLdapTargetAllowed({ serverUrl: "ldap://metadata.google.internal", useTls: false }),
    ).toThrow(AppError);
  });

  it("allows loopback hosts by default (admin's choice — only warns on cleartext)", () => {
    expect(() =>
      assertLdapTargetAllowed({ serverUrl: "ldaps://127.0.0.1:636", useTls: true }),
    ).not.toThrow();
    expect(() =>
      assertLdapTargetAllowed({ serverUrl: "ldap://localhost:389", useTls: false }),
    ).not.toThrow();
    // Loopback is private → no cleartext-remote warning fired.
    expect(warn).not.toHaveBeenCalled();
  });

  it("allows private RFC1918 hosts by default (internal domain controller)", () => {
    expect(() =>
      assertLdapTargetAllowed({ serverUrl: "ldaps://10.0.0.5:636", useTls: true }),
    ).not.toThrow();
    expect(() =>
      assertLdapTargetAllowed({ serverUrl: "ldap://192.168.1.10:389", useTls: false }),
    ).not.toThrow();
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

  describe("LDAP_ALLOWED_HOSTS lockdown", () => {
    it("allows an exact host in the allowlist", async () => {
      vi.stubEnv("LDAP_ALLOWED_HOSTS", "10.0.0.9");
      vi.resetModules();
      const mod = await import("../ldap-ssrf.js");
      expect(() =>
        mod.assertLdapTargetAllowed({ serverUrl: "ldaps://10.0.0.9:636", useTls: true }),
      ).not.toThrow();
      vi.resetModules();
    });

    it("blocks a private host NOT in the allowlist once the lockdown is set", async () => {
      vi.stubEnv("LDAP_ALLOWED_HOSTS", "10.0.0.9");
      vi.resetModules();
      const mod = await import("../ldap-ssrf.js");
      const m = await import("../../../utils/app-error.js");
      expect(() =>
        mod.assertLdapTargetAllowed({ serverUrl: "ldaps://192.168.1.10:636", useTls: true }),
      ).toThrow(m.AppError);
      vi.resetModules();
    });

    it("still blocks the metadata host even when an allowlist is set", async () => {
      vi.stubEnv("LDAP_ALLOWED_HOSTS", "ad.corp.example");
      vi.resetModules();
      const mod = await import("../ldap-ssrf.js");
      const m = await import("../../../utils/app-error.js");
      expect(() =>
        mod.assertLdapTargetAllowed({ serverUrl: "ldaps://169.254.169.254:636", useTls: true }),
      ).toThrow(m.AppError);
      vi.resetModules();
    });
  });
});

describe("assertLdapTargetAllowed — transport confidentiality (A5-07: warn, never block)", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    warn.mockClear();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("allows cleartext ldap:// to a remote host but warns about exposed credentials", () => {
    expect(() =>
      assertLdapTargetAllowed({ serverUrl: "ldap://ad.corp.example:389", useTls: false }),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ host: "ad.corp.example" }),
      expect.stringMatching(/cleartext|unencrypted/i),
    );
  });

  it("allows ldap:// to a remote host with StartTLS (useTls) and does not warn", () => {
    expect(() =>
      assertLdapTargetAllowed({ serverUrl: "ldap://ad.corp.example:389", useTls: true }),
    ).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });

  it("allows ldaps:// to a remote host without StartTLS (implicit TLS) and does not warn", () => {
    expect(() =>
      assertLdapTargetAllowed({ serverUrl: "ldaps://ad.corp.example:636", useTls: false }),
    ).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });

  it("allows tlsSkipVerify for a remote host but warns about disabled cert verification", () => {
    expect(() =>
      assertLdapTargetAllowed({
        serverUrl: "ldaps://ad.corp.example:636",
        useTls: true,
        tlsSkipVerify: true,
      }),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ host: "ad.corp.example" }),
      expect.stringMatching(/tlsSkipVerify|certificate verification is OFF/i),
    );
  });
});
