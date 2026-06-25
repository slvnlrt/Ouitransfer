-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ldap_configs" (
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
    "defaultLocale" TEXT NOT NULL DEFAULT 'en',
    "syncIntervalMinutes" INTEGER NOT NULL DEFAULT 360,
    "useTls" BOOLEAN NOT NULL DEFAULT true,
    "tlsSkipVerify" BOOLEAN NOT NULL DEFAULT false,
    "appUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_ldap_configs" ("appUrl", "bindDn", "bindPassword", "createdAt", "displayNameAttribute", "emailAttribute", "enabled", "id", "searchBase", "serverUrl", "syncGroupDn", "syncIntervalMinutes", "tlsSkipVerify", "updatedAt", "useTls", "usernameAttribute") SELECT "appUrl", "bindDn", "bindPassword", "createdAt", "displayNameAttribute", "emailAttribute", "enabled", "id", "searchBase", "serverUrl", "syncGroupDn", "syncIntervalMinutes", "tlsSkipVerify", "updatedAt", "useTls", "usernameAttribute" FROM "ldap_configs";
DROP TABLE "ldap_configs";
ALTER TABLE "new_ldap_configs" RENAME TO "ldap_configs";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
