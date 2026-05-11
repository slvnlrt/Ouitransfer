/*
  Warnings:

  - You are about to drop the column `attempts` on the `login_attempts` table. All the data in the column will be lost.
  - You are about to drop the column `lastAttempt` on the `login_attempts` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `login_attempts` table. All the data in the column will be lost.
  - Added the required column `email` to the `login_attempts` table without a default value. This is not possible if the table is not empty.
  - Added the required column `ipAddress` to the `login_attempts` table without a default value. This is not possible if the table is not empty.
  - Added the required column `success` to the `login_attempts` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_login_attempts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_login_attempts" ("id") SELECT "id" FROM "login_attempts";
DROP TABLE "login_attempts";
ALTER TABLE "new_login_attempts" RENAME TO "login_attempts";
CREATE INDEX "login_attempts_email_createdAt_idx" ON "login_attempts"("email", "createdAt");
CREATE INDEX "login_attempts_createdAt_idx" ON "login_attempts"("createdAt");
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
    "tokenVersion" INTEGER NOT NULL DEFAULT 0
);
INSERT INTO "new_users" ("createdAt", "email", "firstName", "id", "image", "isActive", "isAdmin", "lastName", "password", "twoFactorBackupCodes", "twoFactorEnabled", "twoFactorSecret", "twoFactorVerified", "updatedAt", "username") SELECT "createdAt", "email", "firstName", "id", "image", "isActive", "isAdmin", "lastName", "password", "twoFactorBackupCodes", "twoFactorEnabled", "twoFactorSecret", "twoFactorVerified", "updatedAt", "username" FROM "users";
DROP TABLE "users";
ALTER TABLE "new_users" RENAME TO "users";
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
