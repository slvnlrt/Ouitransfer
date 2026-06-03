-- AlterTable
ALTER TABLE "reverse_shares" ADD COLUMN "deactivatedAt" DATETIME;
ALTER TABLE "reverse_shares" ADD COLUMN "deactivationReason" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_shares" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "views" INTEGER NOT NULL DEFAULT 0,
    "maxViews" INTEGER,
    "expiration" DATETIME,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "creatorId" TEXT,
    "securityId" TEXT NOT NULL,
    "nameFieldRequired" TEXT NOT NULL DEFAULT 'HIDDEN',
    "emailFieldRequired" TEXT NOT NULL DEFAULT 'HIDDEN',
    "inactivityAlertDays" INTEGER,
    "inactivityAlertSent" BOOLEAN NOT NULL DEFAULT false,
    "lastDownloadedAt" DATETIME,
    "notifyOnDownload" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" DATETIME,
    "deactivationReason" TEXT,
    "notifiedForExpiring" BOOLEAN NOT NULL DEFAULT false,
    "notifiedForExpired" BOOLEAN NOT NULL DEFAULT false,
    "notifiedForMaxViews" BOOLEAN NOT NULL DEFAULT false,
    "notifiedForPendingDeletion" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "shares_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "shares_securityId_fkey" FOREIGN KEY ("securityId") REFERENCES "share_security" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_shares" ("createdAt", "creatorId", "description", "emailFieldRequired", "expiration", "id", "inactivityAlertDays", "inactivityAlertSent", "lastDownloadedAt", "maxViews", "name", "nameFieldRequired", "notifiedForExpired", "notifiedForExpiring", "notifiedForMaxViews", "notifiedForPendingDeletion", "notifyOnDownload", "securityId", "updatedAt", "views") SELECT "createdAt", "creatorId", "description", "emailFieldRequired", "expiration", "id", "inactivityAlertDays", "inactivityAlertSent", "lastDownloadedAt", "maxViews", "name", "nameFieldRequired", "notifiedForExpired", "notifiedForExpiring", "notifiedForMaxViews", "notifiedForPendingDeletion", "notifyOnDownload", "securityId", "updatedAt", "views" FROM "shares";
DROP TABLE "shares";
ALTER TABLE "new_shares" RENAME TO "shares";
CREATE UNIQUE INDEX "shares_securityId_key" ON "shares"("securityId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
