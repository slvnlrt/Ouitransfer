import bcrypt from "bcryptjs";

import { prisma } from "../../shared/prisma.js";
import { ConflictError, NotFoundError } from "../../utils/app-error.js";
import { revokeAllUserTokens } from "../auth/refresh-token.service.js";
import { incrementTokenVersion, invalidateTokenVersionCache } from "../auth/token-version.js";
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
    const isAdmin = usersCount === 0;

    const hashedPassword = await bcrypt.hash(data.password, 10);
    const user = await this.userRepository.createUser({
      ...data,
      password: hashedPassword,
      isAdmin,
    });

    return UserResponseSchema.parse(user);
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

    const updateData: Omit<Partial<UserWithPassword>, "password"> & { password?: string } = {
      ...rest,
    };

    if (password) {
      updateData.password = await bcrypt.hash(password, 10);
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

    return UserResponseSchema.parse(user);
  }

  async deleteUser(id: string) {
    const deleted = await this.userRepository.deleteUser(id);
    // DB cascade deletes refresh tokens, but we must clear the in-memory
    // tokenVersion cache so validateTokenVersion rejects stale JWTs immediately.
    invalidateTokenVersionCache(id);
    return UserResponseSchema.parse(deleted);
  }

  async activateUser(id: string) {
    const user = await this.userRepository.activateUser(id);
    return UserResponseSchema.parse(user);
  }

  async deactivateUser(id: string) {
    const user = await this.userRepository.deactivateUser(id);
    // Deactivated user must not be able to use existing sessions
    await incrementTokenVersion(id);
    await revokeAllUserTokens(id);
    return UserResponseSchema.parse(user);
  }

  async updateUserImage(userId: string, imageUrl: string | null) {
    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        image: imageUrl,
        updatedAt: new Date(),
      },
    });
    return user;
  }
}
