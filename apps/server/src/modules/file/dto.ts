import { z } from "zod";

export const RegisterFileSchema = z.object({
  name: z.string().min(1, "File name is required"),
  description: z.string().optional(),
  extension: z.string().min(1, "File extension is required"),
  mimeType: z.string().optional().describe("MIME type declared by the client"),
  size: z.number({
    required_error: "File size is required",
    invalid_type_error: "File size must be a number",
  }),
  objectName: z.string().min(1, "Object name is required"),
  folderId: z.string().optional(),
});

export const CheckFileSchema = z.object({
  name: z.string().min(1, "File name is required"),
  description: z.string().optional(),
  extension: z.string().min(1, "File extension is required"),
  size: z.number({
    required_error: "File size is required",
    invalid_type_error: "File size must be a number",
  }),
  objectName: z.string().min(1, "Object name is required"),
  folderId: z.string().optional(),
});

export const UpdateFileSchema = z.object({
  name: z.string().optional().describe("The file name"),
  description: z.string().optional().nullable().describe("The file description"),
});

export const MoveFileSchema = z.object({
  folderId: z.string().nullable(),
});

export const ListFilesSchema = z.object({
  folderId: z.string().optional().describe("The folder ID"),
  recursive: z.string().optional().default("true").describe("Include files from subfolders"),
});
