import { z } from "zod";

import { createPasswordPolicySchema } from "./password-policy.js";

export const createPasswordSchema = async () => {
  return createPasswordPolicySchema();
};

/** Login input shape — matches the dynamic schema built in routes.ts */
export interface LoginInput {
  emailOrUsername: string;
  password: string;
}

export const RequestPasswordResetSchema = z.object({
  email: z.string().email("Invalid email").describe("User email"),
});

export const BaseResetPasswordSchema = z.object({
  token: z.string().min(1, "Token is required").describe("Reset password token"),
});

export const createResetPasswordSchema = async () => {
  return BaseResetPasswordSchema.extend({
    password: await createPasswordPolicySchema(),
  });
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
