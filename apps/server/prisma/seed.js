import dotenv from "dotenv";
import { seedDatabase } from "../src/db/seed-data.js";
import { createPrismaClient } from "../src/shared/prisma-factory.js";

// CLI entry point — invoked at container boot (infra/server-start.sh) and by
// `pnpm db:seed`.
//
// Seeding is idempotent ("protected mode": it only inserts MISSING config/provider
// rows and never overwrites operator changes), so server-start.sh runs it
// unconditionally on every boot. That self-heals a partially-seeded database and
// backfills newly-added config keys without any completeness gate.
//
// `quiet: true` stops dotenv (v17+) from printing its banner to stdout — important
// because boot scripts must not pollute stdout that callers may capture.
dotenv.config({ path: [".env", ".env.development"], quiet: true });

const prisma = createPrismaClient();
seedDatabase(prisma)
  .catch((error) => {
    console.error("Error during seed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
