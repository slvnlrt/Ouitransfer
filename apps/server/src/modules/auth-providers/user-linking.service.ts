import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../shared/prisma.js";
import { ForbiddenError, ValidationError } from "../../utils/app-error.js";
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
        return await this.updateExistingUserFromProvider(existingUser, userInfo);
      }

      return await this.linkProviderToExistingUser(
        existingUser,
        provider.id,
        String(externalId),
        userInfo,
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

    return await prisma.user.create({
      data: {
        email: userInfo.email,
        username: userInfo.email.split("@")[0],
        firstName,
        lastName,
        image: userInfo.avatar || null,
        isAdmin: false,
        authProviders: {
          create: {
            providerId,
            externalId,
          },
        },
      },
    });
  }
}
