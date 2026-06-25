-- R5: Email, invite & notification hardening (red-team 2026).

-- A6-04: bind an invite token to the invited email.
-- When set, registration with this token must supply this exact (case-insensitive)
-- address. Null = open/bearer invite by design.
ALTER TABLE "invite_tokens" ADD COLUMN "email" TEXT;

-- A6-03: attribute outbound mail to the user who triggered it so the per-user
-- daily anti-spam quota can be enforced. Null for system/critical mail that does
-- not count toward any user's quota (password resets, admin alerts).
ALTER TABLE "email_jobs" ADD COLUMN "senderUserId" TEXT;

-- Supports the rolling-window per-user quota count (senderUserId + createdAt).
CREATE INDEX "email_jobs_senderUserId_createdAt_idx" ON "email_jobs"("senderUserId", "createdAt");
