import { z } from "zod";

import { getConfigValue } from "../config/service.js";

export const createPasswordSchema = async () => {
  const minLength = Number(await getConfigValue("passwordMinLength"));
  return z
    .string()
    .min(minLength, `Password must be at least ${minLength} characters`)
    .describe("User password");
};

/** Login input shape — matches the dynamic schema built in routes.ts */
export interface LoginInput {
  emailOrUsername: string;
  password: string;
}

export const RequestPasswordResetSchema = z.object({
  email: z.string().email("Invalid email").describe("User email"),
  origin: z.string().url("Invalid origin").describe("Origin of the request"),
});

export const BaseResetPasswordSchema = z.object({
  token: z.string().min(1, "Token is required").describe("Reset password token"),
});

export type BaseResetPasswordInput = z.infer<typeof BaseResetPasswordSchema>;

export const createResetPasswordSchema = async () => {
  const minLength = Number(await getConfigValue("passwordMinLength"));
  return BaseResetPasswordSchema.extend({
    password: z
      .string()
      .min(minLength, `Password must be at least ${minLength} characters`)
      .describe("User password"),
  });
};

export type ResetPasswordInput = BaseResetPasswordInput & {
  password: string;
};

export const CompleteTwoFactorLoginSchema = z.object({
  challengeToken: z
    .string()
    .min(1, "Challenge token is required")
    .describe("Server-issued challenge token from login step"),
  token: z
    .string()
    .min(6, "Two-factor authentication code must be at least 6 characters")
    .describe("2FA token"),
  rememberDevice: z
    .boolean()
    .optional()
    .default(false)
    .describe("Remember this device for 30 days"),
});

export type CompleteTwoFactorLoginInput = z.infer<typeof CompleteTwoFactorLoginSchema>;
