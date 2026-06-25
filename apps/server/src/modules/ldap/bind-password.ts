import { AppError } from "../../utils/app-error.js";
import { LdapConfigRepository } from "./config.repository.js";
import { MASKED_PASSWORD } from "./constants.js";
import { decrypt } from "./encryption.js";

const configRepository = new LdapConfigRepository();

/**
 * The connection-body subset needed to resolve the effective bind password.
 */
export interface BindPasswordInput {
  bindPassword: string;
}

/**
 * Resolve the plaintext bind password for an incoming browse/search request.
 *
 * If the body supplies a real password, it is used as-is (lets the admin browse
 * before the first save). If `bindPassword` is empty or the masked placeholder,
 * the stored encrypted password is loaded and decrypted instead — mirroring the
 * PUT /config masked-password rule so the admin never re-types it.
 *
 * Failure modes surface as `LDAP_*` AppErrors (status 400) so the route's
 * error-genericization rule passes them through to the admin verbatim:
 *  - no stored config yet      → LDAP_BIND_PASSWORD_REQUIRED
 *  - decrypt fails (ENCRYPTION_SECRET missing/invalid) → LDAP_ENCRYPTION_UNAVAILABLE
 */
export async function resolveBindPassword(body: BindPasswordInput): Promise<string> {
  if (body.bindPassword && body.bindPassword !== MASKED_PASSWORD) {
    return body.bindPassword;
  }

  const config = await configRepository.get();
  if (!config) {
    throw new AppError(400, "Bind password is required", "LDAP_BIND_PASSWORD_REQUIRED");
  }

  try {
    return decrypt(config.bindPassword);
  } catch {
    throw new AppError(
      400,
      "LDAP password encryption is unavailable (ENCRYPTION_SECRET not set or invalid)",
      "LDAP_ENCRYPTION_UNAVAILABLE",
    );
  }
}
