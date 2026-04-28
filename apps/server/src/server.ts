import crypto from "node:crypto";
import * as fs from "node:fs/promises";
import fastifyMultipart from "@fastify/multipart";

import { buildApp } from "./app.js";
import { directoriesConfig } from "./config/directories.config.js";
import { env } from "./env.js";
import { appRoutes } from "./modules/app/routes.js";
import { authRoutes } from "./modules/auth/routes.js";
import { authProvidersRoutes } from "./modules/auth-providers/routes.js";
import { fileRoutes } from "./modules/file/routes.js";
import { folderRoutes } from "./modules/folder/routes.js";
import { healthRoutes } from "./modules/health/routes.js";
import { inviteRoutes } from "./modules/invite/routes.js";
import { reverseShareRoutes } from "./modules/reverse-share/routes.js";
import { s3StorageRoutes } from "./modules/s3-storage/routes.js";
import { shareRoutes } from "./modules/share/routes.js";
import { storageRoutes } from "./modules/storage/routes.js";
import { twoFactorRoutes } from "./modules/two-factor/routes.js";
import { userRoutes } from "./modules/user/routes.js";

if (typeof globalThis.crypto === "undefined") {
  // biome-ignore lint/suspicious/noExplicitAny: polyfill requires type cast — webcrypto is compatible with Crypto at runtime
  globalThis.crypto = crypto.webcrypto as any;
}

if (typeof global.crypto === "undefined") {
  // biome-ignore lint/suspicious/noExplicitAny: polyfill requires type cast — webcrypto is compatible with Crypto at runtime
  (global as any).crypto = crypto.webcrypto;
}

async function ensureDirectories() {
  const dirsToCreate = [
    { path: directoriesConfig.uploads, name: "uploads" },
    { path: directoriesConfig.tempUploads, name: "temp-uploads" },
  ];

  for (const dir of dirsToCreate) {
    try {
      await fs.access(dir.path);
    } catch {
      await fs.mkdir(dir.path, { recursive: true });
      console.log(`📁 Created ${dir.name} directory: ${dir.path}`);
    }
  }
}

async function startServer() {
  if (env.SECURE_SITE === "false") {
    console.warn(
      "[SECURITY WARNING] SECURE_SITE=false — cookies will be sent over plain HTTP. Only use this in development.",
    );
  }

  const app = await buildApp();

  await ensureDirectories();
  const { isInternalStorage, isExternalS3 } = await import("./config/storage.config.js");
  const { runAutoMigration } = await import("./scripts/migrate-filesystem-to-s3.js");
  await runAutoMigration();

  await app.register(fastifyMultipart, {
    limits: {
      fieldNameSize: 100,
      fieldSize: 1024 * 1024,
      fields: 10,
      fileSize: 50 * 1024 * 1024, // 50MB
      files: 1,
      headerPairs: 2000,
    },
  });

  app.register(authRoutes);
  app.register(authProvidersRoutes, { prefix: "/auth" });
  app.register(twoFactorRoutes, { prefix: "/auth" });
  app.register(inviteRoutes);
  app.register(userRoutes);
  app.register(folderRoutes);
  app.register(fileRoutes);
  app.register(shareRoutes);
  app.register(reverseShareRoutes);
  app.register(storageRoutes);
  app.register(appRoutes);
  app.register(healthRoutes);
  app.register(s3StorageRoutes);

  if (isInternalStorage) {
    console.log("📦 Using internal storage (auto-configured)");
  } else if (isExternalS3) {
    console.log("📦 Using external S3 storage (AWS/S3-compatible)");
  } else {
    console.log("⚠️  WARNING: Storage not configured! Storage may not work.");
  }

  await app.listen({
    port: 3333,
    host: "0.0.0.0",
  });

  console.log(`🌴 OUITRANSFER server running on port 3333`);

  // Cleanup on shutdown
  process.on("SIGINT", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));
}

startServer().catch((err) => {
  console.error("Error starting server:", err);
  process.exit(1);
});
