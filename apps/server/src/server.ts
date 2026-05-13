import * as fs from "node:fs/promises";
import fastifyMultipart from "@fastify/multipart";

import { buildApp } from "./app.js";
import { directoriesConfig } from "./config/directories.config.js";
import { env } from "./env.js";
import { appRoutes } from "./modules/app/routes.js";
import { auditRoutes } from "./modules/audit/routes.js";
import { cleanupOldAttempts } from "./modules/auth/login-attempts.service.js";
import { cleanupExpiredTokens } from "./modules/auth/refresh-token.service.js";
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

async function ensureDirectories(log: import("fastify").FastifyBaseLogger) {
  const dirsToCreate = [
    { path: directoriesConfig.uploads, name: "uploads" },
    { path: directoriesConfig.tempUploads, name: "temp-uploads" },
  ];

  for (const dir of dirsToCreate) {
    try {
      await fs.access(dir.path);
    } catch {
      await fs.mkdir(dir.path, { recursive: true });
      log.info({ dirName: dir.name, dirPath: dir.path }, "Created directory");
    }
  }
}

async function startServer() {
  // console.warn used here because the Pino logger is not yet initialized (buildApp has not run).
  if (env.SECURE_SITE === "false") {
    console.warn(
      "[SECURITY WARNING] SECURE_SITE=false — cookies will be sent over plain HTTP. Only use this in development.",
    );
  }

  const app = await buildApp();

  await ensureDirectories(app.log);
  const { isInternalStorage, isExternalS3, ensureBucket } = await import(
    "./config/storage.config.js"
  );
  await ensureBucket();

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
  app.register(auditRoutes);
  app.register(healthRoutes);
  app.register(s3StorageRoutes);

  if (isInternalStorage) {
    app.log.info("Using internal storage");
  } else if (isExternalS3) {
    app.log.info("Using external S3 storage (AWS/S3-compatible)");
  } else {
    app.log.warn("Storage not configured — storage may not work");
  }

  // Periodic cleanup of old login attempts (every hour)
  const cleanupInterval = setInterval(
    async () => {
      try {
        const count = await cleanupOldAttempts();
        if (count > 0) {
          app.log.info({ count }, "Cleaned up old login attempts");
        }
      } catch (err) {
        app.log.error({ err }, "Failed to cleanup login attempts");
      }
    },
    60 * 60 * 1000,
  );

  // Periodic cleanup of expired refresh tokens (every hour)
  const refreshCleanupInterval = setInterval(
    async () => {
      try {
        const count = await cleanupExpiredTokens();
        if (count > 0) {
          app.log.info({ count }, "Cleaned up expired refresh tokens");
        }
      } catch (err) {
        app.log.error({ err }, "Failed to cleanup refresh tokens");
      }
    },
    60 * 60 * 1000,
  );

  // Register cleanup hooks BEFORE listen (Fastify rejects hooks after listen)
  app.addHook("onClose", () => clearInterval(cleanupInterval));
  app.addHook("onClose", () => clearInterval(refreshCleanupInterval));

  await app.listen({
    port: env.PORT,
    host: "0.0.0.0",
  });

  app.log.info({ port: env.PORT }, "OUITRANSFER server running");

  // Cleanup on shutdown
  process.on("SIGINT", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));
}

startServer().catch((err) => {
  // console.error used here because this catch handles failures that may occur
  // before the Pino logger is initialized (e.g., buildApp itself failing).
  console.error("Error starting server:", err);
  process.exit(1);
});
