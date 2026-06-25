import type { User } from "../../generated/prisma/client.js";

import { prisma } from "../../shared/prisma.js";
import type { RegisterUserInput, UpdateUserInput } from "./dto.js";

type UserWithGroup = User & { group: { id: string; name: string } | null };

export interface IUserRepository {
  // `isAdmin` is passed explicitly (NOT via the register DTO — A2-07) so admin
  // status can only ever be set by the server-side caller, never from client input.
  createUser(data: RegisterUserInput & { password: string; isAdmin: boolean }): Promise<User>;
  findUserByEmail(email: string): Promise<User | null>;
  findUserById(id: string): Promise<UserWithGroup | null>;
  findUserByUsername(username: string): Promise<User | null>;
  findUserByEmailOrUsername(emailOrUsername: string): Promise<User | null>;
  listUsers(): Promise<UserWithGroup[]>;
  updateUser(
    data: UpdateUserInput & { password?: string; deactivatedAt?: Date | null },
  ): Promise<UserWithGroup>;
  deleteUser(id: string): Promise<UserWithGroup>;
  activateUser(id: string): Promise<UserWithGroup>;
  deactivateUser(id: string): Promise<UserWithGroup>;
}

export class PrismaUserRepository implements IUserRepository {
  async createUser(
    data: RegisterUserInput & { password: string; isAdmin: boolean },
  ): Promise<User> {
    return prisma.user.create({
      data: {
        firstName: data.firstName,
        lastName: data.lastName,
        username: data.username,
        email: data.email,
        password: data.password,
        image: data.image,
        isAdmin: data.isAdmin,
      },
    });
  }

  async findUserByEmail(email: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { email } });
  }

  async findUserById(
    id: string,
  ): Promise<(User & { group: { id: string; name: string } | null }) | null> {
    return prisma.user.findUnique({
      where: { id },
      include: { group: { select: { id: true, name: true } } },
    });
  }

  async findUserByUsername(username: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { username } });
  }

  async findUserByEmailOrUsername(emailOrUsername: string): Promise<User | null> {
    return prisma.user.findFirst({
      where: {
        OR: [{ email: emailOrUsername }, { username: emailOrUsername }],
      },
    });
  }

  async listUsers(): Promise<(User & { group: { id: string; name: string } | null })[]> {
    return prisma.user.findMany({
      include: { group: { select: { id: true, name: true } } },
    });
  }

  async updateUser(data: UpdateUserInput & { password?: string }): Promise<UserWithGroup> {
    const { id, ...rest } = data;
    return prisma.user.update({
      where: { id },
      data: rest,
      include: { group: { select: { id: true, name: true } } },
    });
  }

  async deleteUser(id: string): Promise<UserWithGroup> {
    return prisma.user.delete({
      where: { id },
      include: { group: { select: { id: true, name: true } } },
    });
  }

  async activateUser(id: string): Promise<UserWithGroup> {
    return prisma.user.update({
      where: { id },
      data: { isActive: true, deactivatedAt: null },
      include: { group: { select: { id: true, name: true } } },
    });
  }

  async deactivateUser(id: string): Promise<UserWithGroup> {
    return prisma.user.update({
      where: { id },
      data: { isActive: false, deactivatedAt: new Date() },
      include: { group: { select: { id: true, name: true } } },
    });
  }
}
