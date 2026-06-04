-- CreateTable
CREATE TABLE "reverse_share_recipients" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "notifiedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "reverseShareId" TEXT NOT NULL,
    CONSTRAINT "reverse_share_recipients_reverseShareId_fkey" FOREIGN KEY ("reverseShareId") REFERENCES "reverse_shares" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "reverse_share_recipients_reverseShareId_email_key" ON "reverse_share_recipients"("reverseShareId", "email");
