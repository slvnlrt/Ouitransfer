/*
  Warnings:

  - A unique constraint covering the columns `[ldapDn]` on the table `users` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "users" ADD COLUMN "ldapDn" TEXT;

-- CreateTable
CREATE TABLE "ldap_configs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "serverUrl" TEXT NOT NULL,
    "bindDn" TEXT NOT NULL,
    "bindPassword" TEXT NOT NULL,
    "searchBase" TEXT NOT NULL,
    "syncGroupDn" TEXT NOT NULL,
    "usernameAttribute" TEXT NOT NULL DEFAULT 'sAMAccountName',
    "emailAttribute" TEXT NOT NULL DEFAULT 'mail',
    "displayNameAttribute" TEXT NOT NULL DEFAULT 'displayName',
    "syncIntervalMinutes" INTEGER NOT NULL DEFAULT 360,
    "useTls" BOOLEAN NOT NULL DEFAULT true,
    "tlsSkipVerify" BOOLEAN NOT NULL DEFAULT false,
    "appUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ldap_sync_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "status" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "usersCreated" INTEGER NOT NULL DEFAULT 0,
    "usersUpdated" INTEGER NOT NULL DEFAULT 0,
    "usersDeactivated" INTEGER NOT NULL DEFAULT 0,
    "usersSkipped" INTEGER NOT NULL DEFAULT 0,
    "usersReactivated" INTEGER NOT NULL DEFAULT 0,
    "details" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "ldap_sync_logs_startedAt_idx" ON "ldap_sync_logs"("startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "users_ldapDn_key" ON "users"("ldapDn");
