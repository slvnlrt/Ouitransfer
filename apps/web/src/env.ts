import { z } from "zod";

const envSchema = z.object({
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
});

// Validate at import time — fails fast during build or server start
export const env = envSchema.parse({
  JWT_SECRET: process.env.JWT_SECRET,
});
