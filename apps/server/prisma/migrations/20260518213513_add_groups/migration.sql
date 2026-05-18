-- CreateTable
CREATE TABLE "groups" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "maxFileSizeOverride" BIGINT,
    "maxTotalStorageOverride" BIGINT,
    "ldapDn" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT,
    "image" TEXT,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "twoFactorSecret" TEXT,
    "twoFactorBackupCodes" TEXT,
    "twoFactorVerified" BOOLEAN NOT NULL DEFAULT false,
    "maxFileSizeOverride" BIGINT,
    "maxTotalStorageOverride" BIGINT,
    "groupId" TEXT,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "users_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_users" ("createdAt", "email", "firstName", "id", "image", "isActive", "isAdmin", "lastName", "maxFileSizeOverride", "maxTotalStorageOverride", "password", "tokenVersion", "twoFactorBackupCodes", "twoFactorEnabled", "twoFactorSecret", "twoFactorVerified", "updatedAt", "username") SELECT "createdAt", "email", "firstName", "id", "image", "isActive", "isAdmin", "lastName", "maxFileSizeOverride", "maxTotalStorageOverride", "password", "tokenVersion", "twoFactorBackupCodes", "twoFactorEnabled", "twoFactorSecret", "twoFactorVerified", "updatedAt", "username" FROM "users";
DROP TABLE "users";
ALTER TABLE "new_users" RENAME TO "users";
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "groups_name_key" ON "groups"("name");
