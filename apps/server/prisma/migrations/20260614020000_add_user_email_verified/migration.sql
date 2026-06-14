-- Add `emailVerified` to users (A5-02).
-- A federated identity is never auto-linked to a pre-existing local account
-- unless the IdP asserts a verified email for the SAME address. This column
-- records that proven-ownership state and persists provenance.
ALTER TABLE "users" ADD COLUMN "emailVerified" BOOLEAN NOT NULL DEFAULT false;
