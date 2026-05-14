import { prisma } from "../../shared/prisma.js";
import { NotFoundError } from "../../utils/app-error.js";

export async function getConfigValue(key: string): Promise<string> {
  const config = await prisma.appConfig.findUnique({
    where: { key },
  });

  if (!config) {
    throw new NotFoundError(`Configuration ${key} not found`);
  }

  return config.value;
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
