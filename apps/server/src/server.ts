import * as fs from "node:fs/promises";
import fastifyMultipart from "@fastify/multipart";

import { buildApp } from "./app.js";
import { directoriesConfig } from "./config/directories.config.js";
import { env } from "./env.js";
import { adminRoutes } from "./modules/admin/routes.js";
import { appRoutes } from "./modules/app/routes.js";
import {
  initAuditRetentionOnBoot,
  stopAuditRetentionScheduler,
} from "./modules/audit/retention.scheduler.js";
import { auditRoutes } from "./modules/audit/routes.js";
import { cleanupOldAttempts } from "./modules/auth/login-attempts.service.js";
import { cleanupExpiredTokens } from "./modules/auth/refresh-token.service.js";
import { authRoutes } from "./modules/auth/routes.js";
import { authProvidersRoutes } from "./modules/auth-providers/routes.js";
import { backgroundImageRoutes } from "./modules/background-image/routes.js";
import { initCleanupOnBoot, stopCleanupScheduler } from "./modules/cleanup/cleanup.scheduler.js";
import { initEmailQueueOnBoot, stopEmailQueueScheduler } from "./modules/email/queue.js";
import { fileRoutes } from "./modules/file/routes.js";
import { folderRoutes } from "./modules/folder/routes.js";
import { groupRoutes } from "./modules/group/routes.js";
import { healthRoutes } from "./modules/health/routes.js";
import { inviteRoutes } from "./modules/invite/routes.js";
import { ldapRoutes } from "./modules/ldap/routes.js";
import { initSchedulerOnBoot, stopScheduler } from "./modules/ldap/sync.scheduler.js";
import {
  initNotificationSchedulerOnBoot,
  stopNotificationScheduler,
} from "./modules/notification/notification.scheduler.js";
import { notificationRoutes } from "./modules/notification/routes.js";
import { quotaRoutes } from "./modules/quota/routes.js";
import { reverseShareRoutes } from "./modules/reverse-share/routes.js";
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
  const { isInternalStorage, isExternalS3, ensureBucket, validateStorageEndpoints } = await import(
    "./config/storage.config.js"
  );
  // A3-07: fail fast on an unsafe storage endpoint (private/loopback/link-local/
  // metadata host without opt-in, or http in production). A misconfigured storage
  // endpoint is a security failure — abort boot rather than proceed.
  validateStorageEndpoints();
  try {
    await ensureBucket();
  } catch (error) {
    app.log.warn(
      { err: error },
      "[STORAGE] S3 unreachable at startup — file operations will be unavailable until storage is restored",
    );
  }

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
  app.register(adminRoutes);
  app.register(healthRoutes);
  app.register(quotaRoutes);
  app.register(groupRoutes);
  app.register(ldapRoutes);
  app.register(backgroundImageRoutes);
  app.register(notificationRoutes);

  // Initialize LDAP sync scheduler if configured (fire-and-forget — has internal try/catch)
  void initSchedulerOnBoot();

  // Initialize audit retention scheduler (fire-and-forget — has internal try/catch)
  void initAuditRetentionOnBoot();

  // Initialize email queue scheduler — throws on i18n validation failure (fail-fast)
  await initEmailQueueOnBoot();

  // Initialize notification scheduler (fire-and-forget — has internal try/catch)
  void initNotificationSchedulerOnBoot();

  // Initialize lifecycle cleanup scheduler — after the email queue since cleanup
  // enqueues notification emails (fire-and-forget — has internal try/catch)
  void initCleanupOnBoot();

  if (isInternalStorage) {
    app.log.info("Using internal storage");
  } else if (isExternalS3) {
    app.log.info("Using external S3 storage (AWS/S3-compatible)");
  } else {
    app.log.warn("Storage not configured — storage may not work");
  }

  const ONE_HOUR_MS = 60 * 60 * 1000;

  // --- Login attempts cleanup (every hour, chained setTimeout to prevent overlap) ---
  let loginAttemptsCleanupHandle: ReturnType<typeof setTimeout> | null = null;

  function scheduleLoginAttemptsCleanup(): void {
    const handle = setTimeout(async () => {
      if (loginAttemptsCleanupHandle !== handle) return; // superseded
      try {
        const count = await cleanupOldAttempts();
        if (count > 0) app.log.info({ count }, "Cleaned up old login attempts");
      } catch (err) {
        app.log.error({ err }, "Failed to cleanup login attempts");
      }
      if (loginAttemptsCleanupHandle === handle) scheduleLoginAttemptsCleanup();
    }, ONE_HOUR_MS);
    loginAttemptsCleanupHandle = handle;
  }
  scheduleLoginAttemptsCleanup();

  // --- Refresh token cleanup (every hour, chained setTimeout to prevent overlap) ---
  let refreshCleanupHandle: ReturnType<typeof setTimeout> | null = null;

  function scheduleRefreshCleanup(): void {
    const handle = setTimeout(async () => {
      if (refreshCleanupHandle !== handle) return; // superseded
      try {
        const count = await cleanupExpiredTokens();
        if (count > 0) app.log.info({ count }, "Cleaned up expired refresh tokens");
      } catch (err) {
        app.log.error({ err }, "Failed to cleanup refresh tokens");
      }
      if (refreshCleanupHandle === handle) scheduleRefreshCleanup();
    }, ONE_HOUR_MS);
    refreshCleanupHandle = handle;
  }
  scheduleRefreshCleanup();

  // Register cleanup hooks BEFORE listen (Fastify rejects hooks after listen)
  app.addHook("onClose", () => {
    if (loginAttemptsCleanupHandle) clearTimeout(loginAttemptsCleanupHandle);
    loginAttemptsCleanupHandle = null;
  });
  app.addHook("onClose", () => {
    if (refreshCleanupHandle) clearTimeout(refreshCleanupHandle);
    refreshCleanupHandle = null;
  });
  app.addHook("onClose", () => stopScheduler());
  app.addHook("onClose", () => stopAuditRetentionScheduler());
  app.addHook("onClose", () => stopEmailQueueScheduler());
  app.addHook("onClose", () => stopNotificationScheduler());
  app.addHook("onClose", () => stopCleanupScheduler());

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
