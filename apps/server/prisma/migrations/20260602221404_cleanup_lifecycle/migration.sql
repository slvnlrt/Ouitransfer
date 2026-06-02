-- AlterTable
ALTER TABLE "users" ADD COLUMN "deactivatedAt" DATETIME;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_reverse_shares" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "description" TEXT,
    "expiration" DATETIME,
    "maxFiles" INTEGER,
    "maxFileSize" BIGINT,
    "allowedFileTypes" TEXT,
    "password" TEXT,
    "pageLayout" TEXT NOT NULL DEFAULT 'DEFAULT',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "nameFieldRequired" TEXT NOT NULL DEFAULT 'OPTIONAL',
    "emailFieldRequired" TEXT NOT NULL DEFAULT 'OPTIONAL',
    "notifyOnUpload" BOOLEAN NOT NULL DEFAULT false,
    "bypassUploadCooldown" BOOLEAN NOT NULL DEFAULT false,
    "notifiedForExpiring" BOOLEAN NOT NULL DEFAULT false,
    "notifiedForExpired" BOOLEAN NOT NULL DEFAULT false,
    "notifiedForPendingDeletion" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "backgroundImageId" TEXT,
    "creatorId" TEXT NOT NULL,
    CONSTRAINT "reverse_shares_backgroundImageId_fkey" FOREIGN KEY ("backgroundImageId") REFERENCES "background_images" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "reverse_shares_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_reverse_shares" ("allowedFileTypes", "backgroundImageId", "bypassUploadCooldown", "createdAt", "creatorId", "description", "emailFieldRequired", "expiration", "id", "isActive", "maxFileSize", "maxFiles", "name", "nameFieldRequired", "notifiedForExpired", "notifiedForExpiring", "notifyOnUpload", "pageLayout", "password", "updatedAt") SELECT "allowedFileTypes", "backgroundImageId", "bypassUploadCooldown", "createdAt", "creatorId", "description", "emailFieldRequired", "expiration", "id", "isActive", "maxFileSize", "maxFiles", "name", "nameFieldRequired", "notifiedForExpired", "notifiedForExpiring", "notifyOnUpload", "pageLayout", "password", "updatedAt" FROM "reverse_shares";
DROP TABLE "reverse_shares";
ALTER TABLE "new_reverse_shares" RENAME TO "reverse_shares";
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
    "notifiedForExpiring" BOOLEAN NOT NULL DEFAULT false,
    "notifiedForExpired" BOOLEAN NOT NULL DEFAULT false,
    "notifiedForMaxViews" BOOLEAN NOT NULL DEFAULT false,
    "notifiedForPendingDeletion" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "shares_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "shares_securityId_fkey" FOREIGN KEY ("securityId") REFERENCES "share_security" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_shares" ("createdAt", "creatorId", "description", "emailFieldRequired", "expiration", "id", "inactivityAlertDays", "inactivityAlertSent", "lastDownloadedAt", "maxViews", "name", "nameFieldRequired", "notifiedForExpired", "notifiedForExpiring", "notifiedForMaxViews", "notifyOnDownload", "securityId", "updatedAt", "views") SELECT "createdAt", "creatorId", "description", "emailFieldRequired", "expiration", "id", "inactivityAlertDays", "inactivityAlertSent", "lastDownloadedAt", "maxViews", "name", "nameFieldRequired", "notifiedForExpired", "notifiedForExpiring", "notifiedForMaxViews", "notifyOnDownload", "securityId", "updatedAt", "views" FROM "shares";
DROP TABLE "shares";
ALTER TABLE "new_shares" RENAME TO "shares";
CREATE UNIQUE INDEX "shares_securityId_key" ON "shares"("securityId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
