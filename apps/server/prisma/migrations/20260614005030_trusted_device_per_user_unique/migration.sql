-- Replace the global unique index on deviceHash with a per-user composite unique
-- index. Trusted-device identity is now a random server-issued secret hash scoped
-- to the owning user, so identical hashes across users can no longer collide.
DROP INDEX "trusted_devices_deviceHash_key";

-- CreateIndex
CREATE UNIQUE INDEX "trusted_devices_userId_deviceHash_key" ON "trusted_devices"("userId", "deviceHash");
