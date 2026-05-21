import { createPrismaClient } from "./prisma-factory.js";

const prisma = createPrismaClient();

export { prisma };
