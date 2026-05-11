import * as http from "node:http";
import fastifyCookie from "@fastify/cookie";
import { fastifyCors } from "@fastify/cors";
import helmet from "@fastify/helmet";
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
import { env } from "./env.js";
import { globalErrorHandler, globalNotFoundHandler } from "./utils/error-handler.js";
import { setLogger } from "./utils/logger.js";
import { parseTrustProxy } from "./utils/parse-trust-proxy.js";

export async function buildApp() {
  // JWT_SECRET removed from DB — now in env.ts
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
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
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
    throw new Error(
      "CORS_ORIGINS is required in production. " +
        "Set CORS_ORIGINS=https://your-domain.com (comma-separated for multiple origins).",
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

  // Security headers: CSP, X-Content-Type-Options, X-Frame-Options, etc.
  await app.register(helmet, {
    // Content-Security-Policy is set by Next.js for the frontend;
    // the API doesn't serve HTML, so a restrictive default is fine.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    // HSTS is typically set by the reverse proxy (nginx/caddy), but
    // setting it here provides defense-in-depth.
    strictTransportSecurity: {
      maxAge: 31536000, // 1 year
      includeSubDomains: true,
    },
  });

  app.register(fastifyCookie);
  app.register(fastifyJwt, {
    secret: env.JWT_SECRET,
    cookie: {
      cookieName: "token",
      signed: false,
    },
    sign: {
      expiresIn: "1d",
    },
  });

  const isDevMode = process.env.NODE_ENV !== "production";
  const docsEnabled = isDevMode || env.ENABLE_API_DOCS === "true";

  if (docsEnabled) {
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
  }
  // No else branch — globalNotFoundHandler already returns 404 for unregistered routes.

  return app;
}
