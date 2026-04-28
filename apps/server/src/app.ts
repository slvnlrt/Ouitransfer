import crypto from "node:crypto";
import * as http from "node:http";
import fastifyCookie from "@fastify/cookie";
import { fastifyCors } from "@fastify/cors";
import fastifyJwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import { fastifySwaggerUi } from "@fastify/swagger-ui";
import { fastify } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";

import { registerSwagger } from "./config/swagger.config.js";
import { envTimeoutOverrides } from "./config/timeout.config.js";
import { prisma } from "./shared/prisma.js";
import { globalErrorHandler, globalNotFoundHandler } from "./utils/error-handler.js";
import { setLogger } from "./utils/logger.js";

export async function buildApp() {
  const jwtConfig = await prisma.appConfig.findUnique({
    where: { key: "jwtSecret" },
  });

  const JWT_SECRET = jwtConfig?.value || crypto.randomBytes(64).toString("hex");

  const app = fastify({
    ajv: {
      customOptions: {
        removeAdditional: "all",
      },
    },
    logger: {
      level: process.env.LOG_LEVEL || "info",
    },
    bodyLimit: 50 * 1024 * 1024,
    connectionTimeout: 0,
    keepAliveTimeout: envTimeoutOverrides.keepAliveTimeout,
    requestTimeout: envTimeoutOverrides.requestTimeout,
    trustProxy: true,
    maxParamLength: 500,
    onProtoPoisoning: "error",
    onConstructorPoisoning: "error",
    ignoreTrailingSlash: true,
    serverFactory: (handler: (req: http.IncomingMessage, res: http.ServerResponse) => void) => {
      const server = http.createServer((req: http.IncomingMessage, res: http.ServerResponse) => {
        res.setTimeout(0);
        req.setTimeout(0);

        req.on("close", () => {
          if (typeof global !== "undefined" && global.gc) {
            setImmediate(() => global.gc!());
          }
        });

        handler(req, res);
      });

      server.maxHeadersCount = 0;
      server.timeout = 0;
      server.keepAliveTimeout = envTimeoutOverrides.keepAliveTimeout;
      server.headersTimeout = envTimeoutOverrides.keepAliveTimeout + 1000;

      return server;
    },
  }).withTypeProvider<ZodTypeProvider>();

  setLogger(app.log);

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(globalErrorHandler);
  app.setNotFoundHandler(globalNotFoundHandler);

  app.addSchema({
    $id: "dateFormat",
    type: "string",
    format: "date-time",
  });

  const allowedOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(",").map((o) => o.trim())
    : ["http://localhost:5487"];

  if (!process.env.CORS_ORIGINS && process.env.NODE_ENV === "production") {
    app.log.warn(
      "[SECURITY] CORS_ORIGINS is not set in production. Defaulting to localhost only. " +
        "Set CORS_ORIGINS=https://your-domain.com to allow your frontend.",
    );
  }

  app.register(fastifyCors, {
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) {
        cb(null, true);
      } else {
        cb(new Error("Not allowed by CORS"), false);
      }
    },
    credentials: true,
  });

  await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
    // Trust proxy headers for IP detection
    keyGenerator: (request) => request.ip,
    errorResponseBuilder: (_request, context) => ({
      error: "Too many requests",
      message: `Rate limit exceeded. Try again in ${Math.ceil(context.ttl / 1000)} seconds.`,
      retryAfter: Math.ceil(context.ttl / 1000),
    }),
  });

  app.register(fastifyCookie);
  app.register(fastifyJwt, {
    secret: JWT_SECRET,
    cookie: {
      cookieName: "token",
      signed: false,
    },
    sign: {
      expiresIn: "1d",
    },
  });

  registerSwagger(app);
  app.register(fastifySwaggerUi, {
    routePrefix: "/swagger",
  });

  const { default: scalarFastify } = await import("@scalar/fastify-api-reference");
  app.register(scalarFastify, {
    routePrefix: "/docs",
    configuration: {
      theme: "deepSpace",
    },
  });

  return app;
}
