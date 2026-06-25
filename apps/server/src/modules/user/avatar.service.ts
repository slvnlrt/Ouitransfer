import sharp from "sharp";
import { prisma } from "../../shared/prisma.js";
import { ValidationError } from "../../utils/app-error.js";
import { getLogger } from "../../utils/logger.js";

/**
 * A3-12: cap decoded pixels to defend against image decompression bombs (small,
 * highly-compressed input decoding to hundreds of MB of RAM). 50 Mpx is well
 * above any avatar need and below libvips' ~268 Mpx default. `failOn: "error"`
 * rejects truncated/corrupt inputs.
 */
const SHARP_OPTIONS = { limitInputPixels: 50_000_000, failOn: "error" } as const;

export class AvatarService {
  async uploadAvatar(buffer: Buffer): Promise<string> {
    try {
      const metadata = await sharp(buffer, SHARP_OPTIONS).metadata();
      if (!metadata.width || !metadata.height) {
        throw new ValidationError("Invalid image file");
      }

      const webpBuffer = await sharp(buffer, SHARP_OPTIONS)
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
