import { sweepOrphans } from "../modules/cleanup/service.js";
import { prisma } from "../shared/prisma.js";

/**
 * One-shot maintenance wrapper around the bidirectional orphan sweep.
 *
 * The real reconciliation logic lives in `modules/cleanup/service.ts`
 * (`sweepOrphans`) and is normally driven by the scheduled cleanup job. This
 * script is a thin CLI entry point for running the same sweep manually:
 *
 *   pnpm --filter ouitransfer-api cleanup:orphan-files            # dry run (no deletes)
 *   pnpm --filter ouitransfer-api cleanup:orphan-files:confirm    # actually sweep
 *
 * It covers **both** reconciliation directions — DB rows pointing at missing S3
 * objects *and* S3 objects with no DB row — plus incomplete/abandoned multipart
 * uploads (initiated but never completed or aborted), and applies a min-age guard
 * so in-flight uploads are never touched.
 */

const DEFAULT_MIN_AGE_HOURS = 24;

/** Parse `--min-age-hours=N` (defaults to 24), falling back on invalid input. */
function parseMinAgeHours(argv: string[]): number {
  const arg = argv.find((a) => a.startsWith("--min-age-hours="));
  if (!arg) return DEFAULT_MIN_AGE_HOURS;
  const value = Number(arg.slice("--min-age-hours=".length));
  return Number.isInteger(value) && value >= 1 ? value : DEFAULT_MIN_AGE_HOURS;
}

async function main(): Promise<void> {
  const confirm = process.argv.includes("--confirm");
  const minAgeHours = parseMinAgeHours(process.argv);

  console.log("Orphan sweep (bidirectional S3 <-> DB)");
  console.log(`  min age: ${minAgeHours}h (objects/rows younger than this are protected)`);

  if (!confirm) {
    console.log("\nDry run: previewing candidates (nothing will be deleted).");
    const preview = await sweepOrphans({ minAgeHours, dryRun: true });

    console.log("\nDB rows that WOULD be deleted (missing S3 object):");
    if (preview.dbCandidates && preview.dbCandidates.length > 0) {
      for (const c of preview.dbCandidates) {
        console.log(`  [${c.table}] id=${c.id} object=${c.objectName}`);
      }
    } else {
      console.log("  (none)");
    }

    console.log("\nS3 objects that WOULD be deleted (no DB row):");
    if (preview.s3Candidates && preview.s3Candidates.length > 0) {
      for (const key of preview.s3Candidates) {
        console.log(`  ${key}`);
      }
    } else {
      console.log("  (none)");
    }

    console.log("\nIncomplete multipart uploads that WOULD be aborted (initiated before cutoff):");
    if (preview.multipartCandidates && preview.multipartCandidates.length > 0) {
      for (const c of preview.multipartCandidates) {
        console.log(`  key=${c.key} uploadId=${c.uploadId} initiated=${c.initiatedAt}`);
      }
    } else {
      console.log("  (none)");
    }

    console.log(
      `\nTotals: ${preview.dbDeleted} DB row(s), ${preview.s3Deleted} S3 object(s), ` +
        `${preview.multipartAborted} incomplete multipart upload(s).`,
    );
    console.log(
      "\nRe-run with --confirm to perform the sweep:\n" +
        "  pnpm --filter ouitransfer-api cleanup:orphan-files:confirm",
    );
    return;
  }

  console.log("\nSweeping...");
  const summary = await sweepOrphans({ minAgeHours, dryRun: false });

  console.log("\nDone:");
  console.log(`  DB rows deleted (missing S3 object):   ${summary.dbDeleted}`);
  console.log(`  S3 objects deleted (no DB row):        ${summary.s3Deleted}`);
  console.log(`  incomplete multipart uploads aborted:  ${summary.multipartAborted}`);
  console.log(`  errors (logged, non-fatal):            ${summary.errors}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("\nOrphan sweep failed:", error);
    await prisma.$disconnect();
    process.exit(1);
  });
