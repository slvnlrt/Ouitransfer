import { SUPPORTED_UI_LOCALES } from "@ouitransfer/shared/locales";
import { z } from "zod";

// A2-07: `isAdmin` is intentionally NOT part of the register DTO. Admin status
// is never client-controlled — the first user becomes admin automatically
// (decided server-side in UserService.register), and admin is otherwise granted
// only via the admin-gated `PUT /users`. Keeping `isAdmin` out of this schema
// removes a latent mass-assignment / privilege-escalation footgun should a
// future refactor forward the DTO straight to the repository.
export const BaseRegisterUserSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  username: z.string().min(3),
  email: z.email(),
  image: z.string().optional(),
});

export type BaseRegisterUserInput = z.infer<typeof BaseRegisterUserSchema>;

export type RegisterUserInput = BaseRegisterUserInput & {
  password: string;
};

export const UpdateUserSchema = z.object({
  id: z.string(),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  username: z.string().min(3).optional(),
  email: z.email().optional(),
  image: z.string().optional(),
  password: z.string().optional(),
  isAdmin: z.boolean().optional(),
});

export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;

// Self-service locale preference update (PATCH /users/me/locale). Constrained to
// the locales the app actually ships UI translations for — an unsupported value
// would be stored but never resolve to a matching email translation. The email
// i18n loader maps the stored UI locale down to its base language, so storing a
// full BCP-47 tag (e.g. `fr-FR`) here is correct.
export const UpdateUserLocaleSchema = z.object({
  locale: z.enum(SUPPORTED_UI_LOCALES),
});

export const UserResponseSchema = z.object({
  id: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  username: z.string(),
  email: z.string(),
  image: z.string().nullable(),
  isAdmin: z.boolean(),
  isActive: z.boolean(),
  tokenVersion: z.number(),
  createdAt: z.date(),
  updatedAt: z.date(),
  groupId: z.string().nullable(),
  group: z.object({ id: z.string(), name: z.string() }).nullable().optional(),
  maxFileSizeOverride: z.bigint().nullable(),
  maxTotalStorageOverride: z.bigint().nullable(),
});
