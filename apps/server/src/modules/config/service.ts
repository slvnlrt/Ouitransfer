import { prisma } from "../../shared/prisma.js";
import { InternalError, NotFoundError } from "../../utils/app-error.js";

export async function getConfigValue(key: string): Promise<string> {
  const config = await prisma.appConfig.findUnique({
    where: { key },
  });

  if (!config) {
    throw new NotFoundError(`Configuration ${key} not found`);
  }

  return config.value;
}

export async function setConfigValue(key: string, value: string): Promise<void> {
  await prisma.appConfig.update({
    where: { key },
    data: { value },
  });
}

export async function validatePasswordAuthDisable(): Promise<boolean> {
  const enabledProviders = await prisma.authProvider.findMany({
    where: { enabled: true },
  });

  return enabledProviders.length > 0;
}

export async function validateAllProvidersDisable(): Promise<boolean> {
  const passwordAuthEnabled = await getConfigValue("passwordAuthEnabled");
  return passwordAuthEnabled === "true";
}

export async function getGroupConfigs(group: string): Promise<Record<string, unknown>> {
  const configs = await prisma.appConfig.findMany({
    where: { group },
  });

  return configs.reduce<Record<string, unknown>>((acc, curr) => {
    let value: unknown = curr.value;

    switch (curr.type) {
      case "number":
        value = Number(curr.value);
        break;
      case "boolean":
        value = curr.value === "true";
        break;
      case "json":
        try {
          value = JSON.parse(curr.value);
        } catch {
          throw new InternalError(`Invalid JSON in config key "${curr.key}": ${curr.value}`);
        }
        break;
      case "bigint":
        value = BigInt(curr.value);
        break;
    }

    acc[curr.key] = value;
    return acc;
  }, {});
}
