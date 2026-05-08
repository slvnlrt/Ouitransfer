import sharp from "sharp";
import { prisma } from "../../shared/prisma.js";
import { getLogger } from "../../utils/logger.js";

export class AvatarService {
  async uploadAvatar(buffer: Buffer): Promise<string> {
    try {
      const metadata = await sharp(buffer).metadata();
      if (!metadata.width || !metadata.height) {
        throw new Error("Invalid image file");
      }

      const webpBuffer = await sharp(buffer)
        .resize(100, 100, {
          fit: "cover",
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
      getLogger().error({ err: error }, "Error processing avatar");
      throw error;
    }
  }

  async deleteAvatar(userId: string): Promise<void> {
    try {
      await prisma.user.update({
        where: { id: userId },
        data: {
          image: null,
          updatedAt: new Date(),
        },
      });
    } catch (error) {
      getLogger().error({ err: error }, "Error deleting avatar from database");
      throw error;
    }
  }
}
