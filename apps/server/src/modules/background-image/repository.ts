import { prisma } from "../../shared/prisma.js";
import { ValidationError } from "../../utils/app-error.js";

export class BackgroundImageRepository {
  async findAll() {
    return prisma.backgroundImage.findMany({
      orderBy: { sortOrder: "asc" },
    });
  }

  async findById(id: string) {
    return prisma.backgroundImage.findUnique({ where: { id } });
  }

  async create(data: { name: string | null; s3Key: string; thumbnailS3Key: string }) {
    const maxOrder = await prisma.backgroundImage.aggregate({ _max: { sortOrder: true } });
    const nextOrder = (maxOrder._max.sortOrder ?? -1) + 1;

    return prisma.backgroundImage.create({
      data: { ...data, sortOrder: nextOrder },
    });
  }

  async update(id: string, data: { name?: string }) {
    return prisma.backgroundImage.update({
      where: { id },
      data,
    });
  }

  async reorder(ids: string[]) {
    // Validate no duplicate IDs
    const uniqueIds = new Set(ids);
    if (uniqueIds.size !== ids.length) {
      throw new ValidationError("Duplicate IDs in reorder request");
    }

    // Validate the set matches all existing images
    const existing = await prisma.backgroundImage.findMany({ select: { id: true } });
    const existingIds = new Set(existing.map((img) => img.id));

    if (uniqueIds.size !== existingIds.size || ![...uniqueIds].every((id) => existingIds.has(id))) {
      throw new ValidationError("Reorder request must include all existing image IDs exactly once");
    }

    return prisma.$transaction(
      ids.map((id, index) =>
        prisma.backgroundImage.update({
          where: { id },
          data: { sortOrder: index },
        }),
      ),
    );
  }

  async delete(id: string) {
    return prisma.backgroundImage.delete({ where: { id } });
  }
}
