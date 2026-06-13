-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_share_visits" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shareId" TEXT NOT NULL,
    "recipientId" TEXT,
    "userId" TEXT,
    "visitorName" TEXT,
    "visitorEmail" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "action" TEXT NOT NULL,
    "fileId" TEXT,
    "identificationSource" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "share_visits_shareId_fkey" FOREIGN KEY ("shareId") REFERENCES "shares" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "share_visits_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "share_recipients" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "share_visits_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_share_visits" ("action", "createdAt", "fileId", "id", "identificationSource", "ipAddress", "recipientId", "shareId", "userAgent", "visitorEmail", "visitorName") SELECT "action", "createdAt", "fileId", "id", "identificationSource", "ipAddress", "recipientId", "shareId", "userAgent", "visitorEmail", "visitorName" FROM "share_visits";
DROP TABLE "share_visits";
ALTER TABLE "new_share_visits" RENAME TO "share_visits";
CREATE INDEX "share_visits_shareId_createdAt_idx" ON "share_visits"("shareId", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
