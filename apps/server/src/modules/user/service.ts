import { ErrorCodes } from "@ouitransfer/shared/error-codes";
import bcrypt from "bcryptjs";

import { prisma } from "../../shared/prisma.js";
import { AppError, ConflictError, NotFoundError } from "../../utils/app-error.js";
import { getLogger } from "../../utils/logger.js";
import { redactEmailFromAuditLogs } from "../audit/service.js";
import { BCRYPT_COST } from "../auth/password-policy.js";
import { revokeAllUserTokens } from "../auth/refresh-token.service.js";
import { incrementTokenVersion, invalidateTokenVersionCache } from "../auth/token-version.js";
import { purgeUserContent } from "../cleanup/service.js";
import { emailService } from "../email/service.js";
import { getAppUrl } from "../email/url-builder.js";
import { type RegisterUserInput, UserResponseSchema } from "./dto.js";
import { type IUserRepository, PrismaUserRepository } from "./repository.js";

type UserWithPassword = {
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  password?: string;
  isAdmin?: boolean;
  isActive?: boolean;
};

export class UserService {
  constructor(private readonly userRepository: IUserRepository = new PrismaUserRepository()) {}

  /**
   * Last-admin / self-lockout protection (A2-02).
   *
   * Refuses an admin-removal action (demote → non-admin, deactivate, or delete)
   * when it would either:
   *   1. leave zero active admins (the instance would be permanently unmanageable
   *      — admin routes require `isAdmin` and the setup bypass only triggers at
   *      `user.count() === 0`), or
   *   2. lock the acting admin out of their own account in the same request.
   *
   * Only relevant when the TARGET is currently an admin; demoting/deleting a
   * non-admin can never reduce the admin count below the current admin's own
   * session, so it is allowed unconditionally.
   *
   * @param targetId  The user being changed.
   * @param action    Human-readable action for the error message.
   * @param actorUserId  The authenticated admin performing the change (for the
   *   self-lockout check). Omitted only for the zero-user setup window, where no
   *   admin exists yet and the guard is moot.
   */
  private async assertAdminRemovalAllowed(
    targetId: string,
    action: "demote" | "deactivate" | "delete",
    actorUserId?: string,
  ): Promise<void> {
    const target = await this.userRepository.findUserById(targetId);
    if (!target) {
      throw new NotFoundError("User not found");
    }

    // Acting on a non-admin (or already-inactive admin) cannot remove the last
    // ACTIVE admin, so there is nothing to guard.
    if (!target.isAdmin || !target.isActive) {
      return;
    }

    // Self-lockout: an admin must not deactivate or delete their own account.
    // (Self-demotion is also blocked by the last-admin count when they are the
    // only admin; we additionally hard-block self deactivate/delete for clarity.)
    if (actorUserId && actorUserId === targetId && action !== "demote") {
      throw new AppError(
        409,
        "You cannot deactivate or delete your own admin account.",
        ErrorCodes.LAST_ADMIN,
      );
    }

    // Count OTHER active admins. If none remain, the action would brick admin
    // access — refuse it.
    const otherActiveAdmins = await prisma.user.count({
      where: { isAdmin: true, isActive: true, id: { not: targetId } },
    });

    if (otherActiveAdmins === 0) {
      throw new AppError(
        409,
        "This action would remove the last active administrator and is not allowed.",
        ErrorCodes.LAST_ADMIN,
      );
    }
  }

  async register(data: RegisterUserInput, locale?: string) {
    const existingUser = await this.userRepository.findUserByEmail(data.email);
    const existingUsername = await this.userRepository.findUserByUsername(data.username);

    if (existingUser) {
      throw new ConflictError("User with this email already exists");
    }

    if (existingUsername) {
      throw new ConflictError("User with this username already exists");
    }

    const usersCount = await prisma.user.count();
    const isFirstUser = usersCount === 0;

    const hashedPassword = await bcrypt.hash(data.password, BCRYPT_COST);
    const user = await this.userRepository.createUser({
      ...data,
      password: hashedPassword,
      isAdmin: isFirstUser,
      // Seed the email-language preference from the locale the registrant was
      // using (resolved from their cookie / Accept-Language at the route). Falls
      // back to the schema default ("en") when the request carried no signal, so
      // a user never receives English mail merely because they never opened the
      // language switcher. Undefined → Prisma applies the column default.
      locale,
    });

    // When the first user registers, mark setup as complete so the
    // registration form is no longer shown. This is done server-side
    // to avoid a race condition where the frontend would need to call
    // PATCH /app/configs/firstUserAccess without a JWT token.
    if (isFirstUser) {
      await prisma.appConfig.update({
        where: { key: "firstUserAccess" },
        data: { value: "false" },
      });
    }

    // Notify admins about new user registration (fire-and-forget, skip for first user).
    // Note: The acting admin (if they created the user) also receives the notification.
    // This is acceptable — some teams want confirmation that user creation succeeded.
    if (!isFirstUser) {
      emailService
        .sendToAdmins("admin_user_registered", {
          userName: `${data.firstName} ${data.lastName}`.trim(),
          userEmail: data.email,
          registrationMethod: "password",
        })
        .catch((err) => getLogger().error({ err }, "Failed to send admin_user_registered email"));
    }

    return { ...UserResponseSchema.parse(user), isFirstUser };
  }

  async listUsers() {
    const users = await this.userRepository.listUsers();
    return users.map((user) => UserResponseSchema.parse(user));
  }

  async getUserById(id: string) {
    const user = await this.userRepository.findUserById(id);
    if (!user) {
      throw new NotFoundError("User not found");
    }
    return UserResponseSchema.parse(user);
  }

  async updateUser(userId: string, data: Partial<UserWithPassword>, actorUserId?: string) {
    const { password, ...rest } = data;

    // Fetch old user state to detect isActive transitions
    const oldUser = await this.userRepository.findUserById(userId);
    if (!oldUser) {
      throw new NotFoundError("User not found");
    }

    // A2-02: guard against removing the last admin (demotion or deactivation via
    // the bulk update path) and against self-lockout. Run BEFORE any mutation.
    const isDemotion = data.isAdmin === false && oldUser.isAdmin;
    const isDeactivation = data.isActive === false && oldUser.isActive;
    if (isDemotion) {
      await this.assertAdminRemovalAllowed(userId, "demote", actorUserId);
    }
    if (isDeactivation) {
      await this.assertAdminRemovalAllowed(userId, "deactivate", actorUserId);
    }

    const updateData: Omit<Partial<UserWithPassword>, "password"> & {
      password?: string;
      deactivatedAt?: Date | null;
    } = {
      ...rest,
    };

    if (password) {
      updateData.password = await bcrypt.hash(password, BCRYPT_COST);
    }

    // Keep deactivatedAt in sync with isActive transitions made via admin edit, so the
    // delayed-cleanup window matches the dedicated activate/deactivate paths.
    if (data.isActive !== undefined && data.isActive !== oldUser.isActive) {
      updateData.deactivatedAt = data.isActive ? null : new Date();
    }

    const user = await this.userRepository.updateUser({
      id: userId,
      ...updateData,
    });

    // Invalidate sessions when any security-relevant field changes:
    // password, isAdmin (privilege change), or isActive (deactivation via admin edit)
    const securityFieldChanged = password !== undefined || "isAdmin" in data || "isActive" in data;

    if (securityFieldChanged) {
      await incrementTokenVersion(userId);
      await revokeAllUserTokens(userId);
    }

    // Send account activation/deactivation emails when isActive changes via PUT /users
    if (data.isActive !== undefined && data.isActive !== oldUser.isActive) {
      if (data.isActive) {
        // Reactivated via admin update
        try {
          const loginUrl = await getAppUrl();
          emailService
            .send("account_reactivated", {
              to: user.email,
              locale: user.locale ?? "en",
              userId: user.id,
              data: {
                firstName: user.firstName,
                loginUrl,
              },
            })
            .catch((err) => getLogger().error({ err }, "Failed to send account_reactivated email"));
        } catch (err) {
          getLogger().error({ err }, "Failed to build loginUrl for account_reactivated email");
        }
      } else {
        // Deactivated via admin update
        emailService
          .send("account_deactivated", {
            to: user.email,
            locale: user.locale ?? "en",
            userId: user.id,
            data: {
              firstName: user.firstName,
            },
          })
          .catch((err) => getLogger().error({ err }, "Failed to send account_deactivated email"));
      }
    }

    return UserResponseSchema.parse(user);
  }

  async deleteUser(id: string, actorUserId?: string) {
    // A2-02: refuse to delete the last active admin or the acting admin's own
    // account. Runs before the irreversible purge below.
    await this.assertAdminRemovalAllowed(id, "delete", actorUserId);

    // Full cascade (A8): purge the user's shares, reverse shares, files/folders,
    // and their S3 objects BEFORE removing the user row. This is required for
    // correctness — `Share.creatorId` is `onDelete: SetNull`, so a bare
    // `user.delete()` would orphan the user's shares (and leave every File's S3
    // object dangling). Running the purge first guarantees nothing is left
    // behind. This is an explicit admin action, so it is ungated.
    const purge = await purgeUserContent(id);

    // GDPR erasure: redact the deleted user's identity snapshots from ShareVisit rows that
    // belong to OTHER owners' shares (authenticated visits capture name + email from the user
    // record at visit time). This MUST run before user.delete() so the userId FK is still
    // intact for the WHERE clause (the FK goes SetNull on delete, making targeting impossible
    // after deletion). Best-effort — a failure must not surface as a delete error.
    try {
      const redactedVisits = await prisma.shareVisit.updateMany({
        where: { userId: id },
        data: { visitorEmail: null, visitorName: null },
      });
      if (redactedVisits.count > 0) {
        getLogger().info(
          { userId: id, redacted: redactedVisits.count },
          "Redacted deleted user identity from ShareVisit rows",
        );
      }
    } catch (err) {
      getLogger().error(
        { err, userId: id },
        "Failed to redact deleted user identity from ShareVisit rows",
      );
    }

    const deleted = await this.userRepository.deleteUser(id);
    // DB cascade deletes refresh tokens, but we must clear the in-memory
    // tokenVersion cache so validateTokenVersion rejects stale JWTs immediately.
    invalidateTokenVersionCache(id);

    // GDPR erasure: redact the deleted user's email from historical audit
    // metadata (e.g. share-recipient logs). Best-effort — the user row is
    // already gone, so a failure here must not surface as a delete error.
    try {
      const redacted = await redactEmailFromAuditLogs(deleted.email);
      if (redacted > 0) {
        getLogger().info({ userId: id, redacted }, "Redacted deleted user email from audit logs");
      }
    } catch (err) {
      getLogger().error({ err, userId: id }, "Failed to redact deleted user email from audit logs");
    }

    return { user: UserResponseSchema.parse(deleted), purge };
  }

  async activateUser(id: string) {
    const user = await this.userRepository.activateUser(id);

    // Notify the reactivated user (fire-and-forget)
    try {
      const loginUrl = await getAppUrl();
      emailService
        .send("account_reactivated", {
          to: user.email,
          locale: user.locale ?? "en",
          userId: user.id,
          data: {
            firstName: user.firstName,
            loginUrl,
          },
        })
        .catch((err) => getLogger().error({ err }, "Failed to send account_reactivated email"));
    } catch (err) {
      getLogger().error({ err }, "Failed to build loginUrl for account_reactivated email");
    }

    return UserResponseSchema.parse(user);
  }

  async deactivateUser(id: string, actorUserId?: string) {
    // A2-02: refuse to deactivate the last active admin or the acting admin's
    // own account.
    await this.assertAdminRemovalAllowed(id, "deactivate", actorUserId);

    const user = await this.userRepository.deactivateUser(id);
    // Deactivated user must not be able to use existing sessions
    await incrementTokenVersion(id);
    await revokeAllUserTokens(id);

    // Notify the deactivated user (fire-and-forget)
    emailService
      .send("account_deactivated", {
        to: user.email,
        locale: user.locale ?? "en",
        userId: user.id,
        data: {
          firstName: user.firstName,
        },
      })
      .catch((err) => getLogger().error({ err }, "Failed to send account_deactivated email"));

    return UserResponseSchema.parse(user);
  }

  async updateUserImage(userId: string, imageUrl: string | null) {
    const user = await prisma.user.update({
      where: { id: userId },
      // `updatedAt` is `@updatedAt` — Prisma stamps it automatically on update.
      data: { image: imageUrl },
      include: { group: { select: { id: true, name: true } } },
    });
    return user;
  }

  /**
   * Persists the caller's preferred UI locale. This is the language signal used
   * when emailing the user — and, for invitations they send, the best-available
   * signal for their external recipients (who have no account of their own). The
   * value is a full BCP-47 tag (e.g. `fr-FR`); the email i18n loader maps it down
   * to a base language and falls back to English when no translation exists.
   *
   * `locale` is validated against `SUPPORTED_UI_LOCALES` at the route boundary.
   */
  async updateLocale(userId: string, locale: string): Promise<{ locale: string }> {
    const user = await prisma.user.update({
      where: { id: userId },
      // `updatedAt` is `@updatedAt` — Prisma stamps it automatically on update.
      data: { locale },
      select: { locale: true },
    });
    return { locale: user.locale };
  }
}
