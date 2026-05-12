import type { FastifyRequest } from "fastify";

import { ValidationError } from "../../utils/app-error.js";
import { getConfigValue } from "../config/service.js";

export async function validatePasswordMiddleware(request: FastifyRequest) {
  const body = request.body as { password?: string };
  if (!body.password) return;

  const minLength = Number(await getConfigValue("passwordMinLength"));

  if (body.password.length < minLength) {
    throw new ValidationError(`Password must be at least ${minLength} characters long`);
  }
}
