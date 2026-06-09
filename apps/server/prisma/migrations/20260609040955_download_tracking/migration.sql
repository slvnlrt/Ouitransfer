-- AlterTable
ALTER TABLE "share_visits" ADD COLUMN "identificationSource" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_reverse_share_recipients" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "notifiedAt" DATETIME,
    "uploadCount" INTEGER NOT NULL DEFAULT 0,
    "uploadedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "reverseShareId" TEXT NOT NULL,
    CONSTRAINT "reverse_share_recipients_reverseShareId_fkey" FOREIGN KEY ("reverseShareId") REFERENCES "reverse_shares" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_reverse_share_recipients" ("createdAt", "email", "id", "name", "notifiedAt", "reverseShareId", "updatedAt") SELECT "createdAt", "email", "id", "name", "notifiedAt", "reverseShareId", "updatedAt" FROM "reverse_share_recipients";
DROP TABLE "reverse_share_recipients";
ALTER TABLE "new_reverse_share_recipients" RENAME TO "reverse_share_recipients";
CREATE UNIQUE INDEX "reverse_share_recipients_reverseShareId_email_key" ON "reverse_share_recipients"("reverseShareId", "email");
CREATE TABLE "new_share_recipients" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "shareId" TEXT NOT NULL,
    "name" TEXT,
    "trackingToken" TEXT,
    "notifiedAt" DATETIME,
    "lastAccessedAt" DATETIME,
    "accessCount" INTEGER NOT NULL DEFAULT 0,
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "lastDownloadedAt" DATETIME,
    CONSTRAINT "share_recipients_shareId_fkey" FOREIGN KEY ("shareId") REFERENCES "shares" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_share_recipients" ("accessCount", "createdAt", "email", "id", "lastAccessedAt", "name", "notifiedAt", "shareId", "trackingToken", "updatedAt") SELECT "accessCount", "createdAt", "email", "id", "lastAccessedAt", "name", "notifiedAt", "shareId", "trackingToken", "updatedAt" FROM "share_recipients";
DROP TABLE "share_recipients";
ALTER TABLE "new_share_recipients" RENAME TO "share_recipients";
CREATE UNIQUE INDEX "share_recipients_trackingToken_key" ON "share_recipients"("trackingToken");
CREATE UNIQUE INDEX "share_recipients_shareId_email_key" ON "share_recipients"("shareId", "email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
