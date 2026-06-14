import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../shared/prisma.js";
import { ForbiddenError, ValidationError } from "../../utils/app-error.js";
import { getLogger } from "../../utils/logger.js";
import { emailService } from "../email/service.js";
import type { AuthProviderModel, ProviderUserInfo } from "./types.js";

type ExistingUser = Prisma.UserGetPayload<Record<string, never>>;

export class UserLinkingService {
  async findOrCreateUser(
    userInfo: ProviderUserInfo,
    provider: Pick<AuthProviderModel, "id" | "name" | "displayName" | "autoRegister">,
  ) {
    const externalId = userInfo.id;

    if (!userInfo.email || !externalId) {
      throw new ValidationError("Missing required user information (email or external ID)");
    }

    const existingAuthProvider = await this.findExistingAuthProvider(
      provider.id,
      String(externalId),
    );
    if (existingAuthProvider) {
      return await this.updateExistingUserFromProvider(existingAuthProvider.user, userInfo);
    }

    const existingUser = await this.findExistingUserByEmail(userInfo.email);
    if (existingUser) {
      const existingUserProvider = await prisma.userAuthProvider.findFirst({
        where: {
          userId: existingUser.id,
          providerId: provider.id,
        },
      });

      if (existingUserProvider) {
        // Already linked to THIS provider — a normal repeat SSO login, safe to
        // update profile and return.
        return await this.updateExistingUserFromProvider(existingUser, userInfo);
      }

      // A5-02: NEVER auto-link a federated identity to a pre-existing local
      // account on a matching email alone. Auto-linking is only permitted when
      // BOTH the IdP asserted the email as verified AND the local account's email
      // is already proven owned (verified). Otherwise an attacker who can set an
      // arbitrary email at any IdP could take over the local account.
      if (userInfo.emailVerified === true && existingUser.emailVerified === true) {
        return await this.linkProviderToExistingUser(
          existingUser,
          provider.id,
          String(externalId),
          userInfo,
        );
      }

      // Refuse: a local account exists for this email but ownership has not been
      // proven by the IdP (or the local account is itself unverified). Do not log
      // in. The user must connect the SSO identity from an authenticated session
      // (explicit link) instead.
      throw new ForbiddenError(
        "An account with this email already exists. Sign in with your existing method, " +
          "then connect this provider from your account settings.",
      );
    }

    // Check if auto-registration is disabled
    if (provider.autoRegister === false) {
      throw new ForbiddenError(
        `User registration via ${provider.displayName || provider.name} is disabled`,
      );
    }

    return await this.createNewUserWithProvider(userInfo, provider.id, String(externalId));
  }

  private async findExistingAuthProvider(providerId: string, externalId: string) {
    return await prisma.userAuthProvider.findUnique({
      where: {
        providerId_externalId: {
          providerId,
          externalId,
        },
      },
      include: {
        user: true,
      },
    });
  }

  private async findExistingUserByEmail(email: string) {
    return await prisma.user.findUnique({
      where: { email },
    });
  }

  private buildUserUpdateData(
    existingUser: ExistingUser,
    userInfo: ProviderUserInfo,
  ): Prisma.UserUpdateInput {
    const updateData: Prisma.UserUpdateInput = {};

    if (!existingUser.firstName && userInfo.firstName) {
      updateData.firstName = userInfo.firstName;
    }

    if (!existingUser.lastName && userInfo.lastName) {
      updateData.lastName = userInfo.lastName;
    }

    if (!existingUser.image && userInfo.avatar) {
      updateData.image = userInfo.avatar;
    }

    return updateData;
  }

  private async updateExistingUserFromProvider(
    existingUser: ExistingUser,
    userInfo: ProviderUserInfo,
  ) {
    const updateData = this.buildUserUpdateData(existingUser, userInfo);

    if (Object.keys(updateData).length > 0) {
      return await prisma.user.update({
        where: { id: existingUser.id },
        data: updateData,
      });
    }

    return existingUser;
  }

  private async linkProviderToExistingUser(
    existingUser: ExistingUser,
    providerId: string,
    externalId: string,
    userInfo: ProviderUserInfo,
  ) {
    await prisma.userAuthProvider.create({
      data: {
        userId: existingUser.id,
        providerId,
        externalId,
        // Provenance: record that this link was established off a verified-email
        // claim (the only path that reaches here per A5-02).
        metadata: JSON.stringify({ emailVerifiedAtLink: true, linkedAt: new Date().toISOString() }),
      },
    });

    return await this.updateExistingUserFromProvider(existingUser, userInfo);
  }

  private generateUserNames(userInfo: ProviderUserInfo) {
    const displayName = userInfo.name || userInfo.email.split("@")[0];
    const firstName =
      userInfo.firstName || displayName.split(" ")[0] || userInfo.email.split("@")[0];
    const lastName =
      userInfo.lastName ||
      (displayName.split(" ").length > 1 ? displayName.split(" ").slice(1).join(" ") : "");

    return { firstName, lastName };
  }

  private async createNewUserWithProvider(
    userInfo: ProviderUserInfo,
    providerId: string,
    externalId: string,
  ) {
    const { firstName, lastName } = this.generateUserNames(userInfo);

    const user = await prisma.user.create({
      data: {
        email: userInfo.email,
        username: userInfo.email.split("@")[0],
        firstName,
        lastName,
        image: userInfo.avatar || null,
        isAdmin: false,
        // A5-02: persist whether the IdP proved ownership of this email. A future
        // local login or SSO link decision keys off this flag.
        emailVerified: userInfo.emailVerified === true,
        authProviders: {
          create: {
            providerId,
            externalId,
            metadata: JSON.stringify({
              emailVerifiedAtCreate: userInfo.emailVerified === true,
              createdAt: new Date().toISOString(),
            }),
          },
        },
      },
    });

    // Notify admins about new SSO/OIDC user registration (fire-and-forget).
    // Skip if this is the very first user (no admins to notify).
    const usersCount = await prisma.user.count();
    if (usersCount > 1) {
      emailService
        .sendToAdmins("admin_user_registered", {
          userName: `${firstName} ${lastName}`.trim() || user.username,
          userEmail: user.email,
          registrationMethod: "oidc",
        })
        .catch((err) =>
          getLogger().error({ err }, "Failed to send admin_user_registered email for OIDC user"),
        );
    }

    return user;
  }
}
