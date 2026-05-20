import { prisma } from "../../shared/prisma.js";
import { ForbiddenError, NotFoundError } from "../../utils/app-error.js";
import { getConfigValue, validatePasswordAuthDisable } from "../config/service.js";

export class AppService {
  async getAppInfo() {
    const [appName, appDescription, appLogo, firstUserAccess] = await Promise.all([
      getConfigValue("appName"),
      getConfigValue("appDescription"),
      getConfigValue("appLogo"),
      getConfigValue("firstUserAccess"),
    ]);

    return {
      appName,
      appDescription,
      appLogo,
      firstUserAccess: firstUserAccess === "true",
    };
  }

  async getSystemInfo() {
    return {
      storageProvider: "s3" as const,
      s3Enabled: true,
    };
  }

  async getAllConfigs() {
    return prisma.appConfig.findMany({
      orderBy: {
        group: "asc",
      },
    });
  }

  async getPublicConfigs() {
    const sensitiveKeys = [
      "smtpHost",
      "smtpPort",
      "smtpUser",
      "smtpPass",
      "smtpSecure",
      "smtpNoAuth",
      "smtpTrustSelfSigned",
    ];

    return prisma.appConfig.findMany({
      where: {
        key: {
          notIn: sensitiveKeys,
        },
      },
      orderBy: {
        group: "asc",
      },
    });
  }

  async updateConfig(key: string, value: string) {
    if (key === "passwordAuthEnabled") {
      if (value === "false") {
        const canDisable = await validatePasswordAuthDisable();
        if (!canDisable) {
          throw new ForbiddenError(
            "Password authentication cannot be disabled. At least one authentication provider must be active.",
          );
        }
      }
    }

    const config = await prisma.appConfig.findUnique({
      where: { key },
    });

    if (!config) {
      throw new NotFoundError("Configuration not found");
    }

    return prisma.appConfig.update({
      where: { key },
      data: { value },
    });
  }

  async bulkUpdateConfigs(updates: Array<{ key: string; value: string }>) {
    const passwordAuthUpdate = updates.find((update) => update.key === "passwordAuthEnabled");
    if (passwordAuthUpdate && passwordAuthUpdate.value === "false") {
      const canDisable = await validatePasswordAuthDisable();
      if (!canDisable) {
        throw new ForbiddenError(
          "Password authentication cannot be disabled. At least one authentication provider must be active.",
        );
      }
    }

    const keys = updates.map((update) => update.key);
    const existingConfigs = await prisma.appConfig.findMany({
      where: { key: { in: keys } },
    });

    if (existingConfigs.length !== keys.length) {
      const existingKeys = existingConfigs.map((config) => config.key);
      const missingKeys = keys.filter((key) => !existingKeys.includes(key));
      throw new NotFoundError(`Configurations not found: ${missingKeys.join(", ")}`);
    }

    return prisma.$transaction(
      updates.map((update) =>
        prisma.appConfig.update({
          where: { key: update.key },
          data: { value: update.value },
        }),
      ),
    );
  }
}
