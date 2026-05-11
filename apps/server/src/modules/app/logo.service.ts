import sharp from "sharp";
import { prisma } from "../../shared/prisma.js";
import { ValidationError } from "../../utils/app-error.js";
import { getLogger } from "../../utils/logger.js";

export class LogoService {
  async uploadLogo(buffer: Buffer): Promise<string> {
    try {
      const metadata = await sharp(buffer).metadata();
      if (!metadata.width || !metadata.height) {
        throw new ValidationError("Invalid image file");
      }

      const webpBuffer = await sharp(buffer)
        .resize(100, 100, {
          fit: "contain",
          background: { r: 255, g: 255, b: 255, alpha: 0 },
        })
        .webp({
          quality: 60,
          effort: 6,
          nearLossless: true,
          alphaQuality: 100,
          lossless: true,
        })
        .toBuffer();

      return `data:image/webp;base64,${webpBuffer.toString("base64")}`;
    } catch (error) {
      getLogger().error({ err: error }, "Error processing logo");
      throw error;
    }
  }

  async deleteLogo(): Promise<void> {
    try {
      await prisma.appConfig.update({
        where: { key: "appLogo" },
        data: {
          value: "",
          updatedAt: new Date(),
        },
      });
    } catch (error) {
      getLogger().error({ err: error }, "Error deleting logo from database");
      throw error;
    }
  }
}
