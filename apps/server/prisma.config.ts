import dotenv from "dotenv";
import { defineConfig } from "prisma/config";
import { DEFAULT_DATABASE_URL } from "./src/shared/prisma-factory.js";

dotenv.config({ path: [".env", ".env.development"] });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.js",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
  },
});
