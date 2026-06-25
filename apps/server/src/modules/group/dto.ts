import { z } from "zod";
import { quotaOverrideField } from "../../shared/quota-schema.js";

export const CreateGroupSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Group name is required")
    .max(100, "Group name must be at most 100 characters"),
  description: z.string().max(500, "Description must be at most 500 characters").optional(),
  ldapDn: z.string().max(2048, "LDAP DN must be at most 2048 characters").nullable().optional(),
  maxFileSizeOverride: quotaOverrideField.optional(),
  maxTotalStorageOverride: quotaOverrideField.optional(),
});

export const UpdateGroupSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  ldapDn: z.string().max(2048, "LDAP DN must be at most 2048 characters").nullable().optional(),
  maxFileSizeOverride: quotaOverrideField.optional(),
  maxTotalStorageOverride: quotaOverrideField.optional(),
});

export const AddMemberSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
});
