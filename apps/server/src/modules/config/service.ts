import { prisma } from "../../shared/prisma.js";

export class ConfigService {
  async getValue(key: string): Promise<string> {
    const config = await prisma.appConfig.findUnique({
      where: { key },
    });

    if (!config) {
      throw new Error(`Configuration ${key} not found`);
    }

    return config.value;
  }

  async setValue(key: string, value: string): Promise<void> {
    await prisma.appConfig.update({
      where: { key },
      data: { value },
    });
  }

  async validatePasswordAuthDisable(): Promise<boolean> {
    const enabledProviders = await prisma.authProvider.findMany({
      where: { enabled: true },
    });

    return enabledProviders.length > 0;
  }

  async validateAllProvidersDisable(): Promise<boolean> {
    const passwordAuthEnabled = await this.getValue("passwordAuthEnabled");
    return passwordAuthEnabled === "true";
  }

  async getGroupConfigs(group: string) {
    const configs = await prisma.appConfig.findMany({
      where: { group },
    });

    return configs.reduce<Record<string, unknown>>(
      (acc, curr) => {
        let value: unknown = curr.value;

        switch (curr.type) {
          case "number":
            value = Number(curr.value);
            break;
          case "boolean":
            value = curr.value === "true";
            break;
          case "json":
            value = JSON.parse(curr.value);
            break;
          case "bigint":
            value = BigInt(curr.value);
            break;
        }

        acc[curr.key] = value;
        return acc;
      },
      {} as Record<string, unknown>,
    );
  }
}
