/**
 * Unit tests for resolveBindPassword — the shared masked-password resolver used
 * by the directory-browse and group-search routes.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../../../utils/app-error.js";

const getMock = vi.fn();
const decryptMock = vi.fn();

vi.mock("../config.repository.js", () => ({
  LdapConfigRepository: class {
    get = getMock;
  },
}));

vi.mock("../encryption.js", () => ({
  decrypt: (...args: unknown[]) => decryptMock(...args),
}));

const { resolveBindPassword } = await import("../bind-password.js");
const { MASKED_PASSWORD } = await import("../constants.js");

beforeEach(() => {
  getMock.mockReset();
  decryptMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("resolveBindPassword", () => {
  it("returns a freshly-typed password verbatim without touching storage", async () => {
    const result = await resolveBindPassword({ bindPassword: "typed-secret" });

    expect(result).toBe("typed-secret");
    expect(getMock).not.toHaveBeenCalled();
    expect(decryptMock).not.toHaveBeenCalled();
  });

  it("decrypts the stored password when the body holds the masked placeholder", async () => {
    getMock.mockResolvedValue({ bindPassword: "ENC(stored)" });
    decryptMock.mockReturnValue("stored-plaintext");

    const result = await resolveBindPassword({ bindPassword: MASKED_PASSWORD });

    expect(result).toBe("stored-plaintext");
    expect(decryptMock).toHaveBeenCalledWith("ENC(stored)");
  });

  it("decrypts the stored password when the body holds an empty string", async () => {
    getMock.mockResolvedValue({ bindPassword: "ENC(stored)" });
    decryptMock.mockReturnValue("stored-plaintext");

    const result = await resolveBindPassword({ bindPassword: "" });

    expect(result).toBe("stored-plaintext");
  });

  it("throws LDAP_BIND_PASSWORD_REQUIRED when no config is stored yet", async () => {
    getMock.mockResolvedValue(null);

    await expect(resolveBindPassword({ bindPassword: "" })).rejects.toMatchObject({
      statusCode: 400,
      code: "LDAP_BIND_PASSWORD_REQUIRED",
    });
    expect(decryptMock).not.toHaveBeenCalled();
  });

  it("throws LDAP_ENCRYPTION_UNAVAILABLE when decrypt fails", async () => {
    getMock.mockResolvedValue({ bindPassword: "ENC(stored)" });
    decryptMock.mockImplementation(() => {
      throw new Error("ENCRYPTION_SECRET missing");
    });

    const error = await resolveBindPassword({ bindPassword: MASKED_PASSWORD }).catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe("LDAP_ENCRYPTION_UNAVAILABLE");
  });
});
