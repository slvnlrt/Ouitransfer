import bcrypt from "bcryptjs";

import { prisma } from "../../shared/prisma.js";
import { ConflictError, NotFoundError } from "../../utils/app-error.js";
import { getLogger } from "../../utils/logger.js";
import { redactEmailFromAuditLogs } from "../audit/service.js";
import { revokeAllUserTokens } from "../auth/refresh-token.service.js";
import { incrementTokenVersion, invalidateTokenVersionCache } from "../auth/token-version.js";
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

  async register(data: RegisterUserInput) {
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

    const hashedPassword = await bcrypt.hash(data.password, 10);
    const user = await this.userRepository.createUser({
      ...data,
      password: hashedPassword,
      isAdmin: isFirstUser,
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

  async updateUser(userId: string, data: Partial<UserWithPassword>) {
    const { password, ...rest } = data;

    // Fetch old user state to detect isActive transitions
    const oldUser = await this.userRepository.findUserById(userId);
    if (!oldUser) {
      throw new NotFoundError("User not found");
    }

    const updateData: Omit<Partial<UserWithPassword>, "password"> & {
      password?: string;
      deactivatedAt?: Date | null;
    } = {
      ...rest,
    };

    if (password) {
      updateData.password = await bcrypt.hash(password, 10);
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

  async deleteUser(id: string) {
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

    return UserResponseSchema.parse(deleted);
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

  async deactivateUser(id: string) {
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
      data: {
        image: imageUrl,
        updatedAt: new Date(),
      },
      include: { group: { select: { id: true, name: true } } },
    });
    return user;
  }
}
