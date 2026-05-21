import { prisma } from "../../shared/prisma.js";

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
