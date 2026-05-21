import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../../prisma/generated/prisma/client.js";

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL ?? "file:./prisma/ouitransfer.db",
});

const prisma = new PrismaClient({ adapter });

export { prisma };
