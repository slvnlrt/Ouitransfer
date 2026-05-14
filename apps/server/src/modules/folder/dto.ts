import { z } from "zod";

export const RegisterFolderSchema = z.object({
  name: z.string().min(1, "Folder name is required"),
  description: z.string().optional(),
  objectName: z.string().min(1, "Object name is required"),
  parentId: z.string().optional(),
});

export const UpdateFolderSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional().nullable(),
});

export const MoveFolderSchema = z.object({
  parentId: z.string().nullable(),
});

export const CheckFolderSchema = z.object({
  name: z.string().min(1, "Folder name is required"),
  description: z.string().optional(),
  objectName: z.string().min(1, "Object name is required"),
  parentId: z.string().optional(),
});

export const ListFoldersSchema = z.object({
  parentId: z.string().optional(),
  recursive: z.string().optional().default("true"),
});
