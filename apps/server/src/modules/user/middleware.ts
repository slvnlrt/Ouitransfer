import type { FastifyRequest } from "fastify";

import { ValidationError } from "../../utils/app-error.js";
import { ConfigService } from "../config/service.js";

const configService = new ConfigService();

export async function validatePasswordMiddleware(request: FastifyRequest) {
  const body = request.body as { password?: string };
  if (!body.password) return;

  const minLength = Number(await configService.getValue("passwordMinLength"));

  if (body.password.length < minLength) {
    throw new ValidationError(`Password must be at least ${minLength} characters long`);
  }
}
