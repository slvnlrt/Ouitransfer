import { z } from "zod";

export const BackgroundImageResponseSchema = z.object({
  id: z.string().describe("Image ID"),
  name: z.string().nullable().describe("Display name"),
  thumbnailUrl: z.string().describe("Presigned thumbnail URL"),
  fullUrl: z.string().describe("Presigned full image URL"),
  sortOrder: z.number().describe("Sort order"),
  createdAt: z.string().describe("Creation date"),
  updatedAt: z.string().describe("Update date"),
});

export const UpdateBackgroundImageSchema = z.object({
  name: z.string().min(1).describe("New display name"),
});

export const ReorderBackgroundImagesSchema = z.object({
  ids: z.array(z.string()).min(1).describe("Ordered array of image IDs"),
});

export type BackgroundImageResponse = z.infer<typeof BackgroundImageResponseSchema>;
