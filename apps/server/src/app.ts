import * as http from "node:http";
import fastifyCookie from "@fastify/cookie";
import { fastifyCors } from "@fastify/cors";
import fastifyCsrf from "@fastify/csrf-protection";
import formbody from "@fastify/formbody";
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
import { CSRF_EXEMPT_ROUTES } from "./config/csrf.config.js";
import { registerSwagger } from "./config/swagger.config.js";
import { envTimeoutOverrides, timeoutConfig } from "./config/timeout.config.js";
import { env } from "./env.js";
import { validateTokenVersion } from "./modules/auth/token-version.js";
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
    connectionTimeout: timeoutConfig.connection.timeout,
    keepAliveTimeout: envTimeoutOverrides.keepAliveTimeout,
    requestTimeout: envTimeoutOverrides.requestTimeout,
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    maxParamLength: 500,
    onProtoPoisoning: "error",
    onConstructorPoisoning: "error",
    ignoreTrailingSlash: true,
    serverFactory: (handler: (req: http.IncomingMessage, res: http.ServerResponse) => void) => {
      const server = http.createServer((req: http.IncomingMessage, res: http.ServerResponse) => {
        // Do not call res.setTimeout(0) or req.setTimeout(0) here — Fastify manages
        // socket timeouts via connectionTimeout and requestTimeout. Overriding them
        // to 0 disables all timeout protection and opens the door to slowloris attacks.

        req.on("close", () => {
          if (typeof global !== "undefined" && global.gc) {
            setImmediate(() => global.gc!());
          }
        });

        handler(req, res);
      });

      server.maxHeadersCount = 0;
      // Set the Node.js http.Server timeout to match our request timeout env override.
      // This is a backstop in case Fastify's requestTimeout is not sufficient.
      server.timeout = envTimeoutOverrides.requestTimeout;
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
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });

  const isDevMode = process.env.NODE_ENV !== "production";
  const docsEnabled = isDevMode || env.ENABLE_API_DOCS === "true";

  // Security headers: CSP, X-Content-Type-Options, X-Frame-Options, etc.
  // Registered BEFORE rate-limit so security headers apply to all responses,
  // including rate-limit rejections.
  //
  // When Swagger UI / Scalar docs are enabled, we relax CSP to allow the
  // assets those UIs need (inline scripts/styles, data: URIs for images).
  // This relaxation only applies when docsEnabled is true (dev or explicit opt-in).
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: docsEnabled
        ? {
            // Swagger UI and Scalar require inline scripts/styles and data: images.
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:"],
            frameAncestors: ["'none'"],
          }
        : {
            // The API doesn't serve HTML in production; a restrictive default is fine.
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

  app.register(fastifyCookie, {
    secret: env.COOKIE_SECRET,
  });
  app.register(fastifyJwt, {
    secret: env.JWT_SECRET,
    cookie: {
      cookieName: "token",
      signed: true,
    },
    sign: {
      expiresIn: "15m", // Short-lived — refresh token handles session persistence
    },
    // Validate tokenVersion on every jwtVerify() call.
    // Returning false causes jwtVerify to throw "Untrusted token".
    trusted: validateTokenVersion,
  });

  // ── Form body parsing ───────────────────────────────────────
  // Enables parsing of application/x-www-form-urlencoded request bodies.
  // Required for the unsubscribe flow (HTML form POST) and RFC 8058
  // one-click List-Unsubscribe headers.
  await app.register(formbody);

  // ── CSRF Protection (double-submit cookie pattern) ──────────
  // Must be registered after @fastify/cookie.
  // The plugin stores a secret in an httpOnly _csrf cookie and derives
  // tokens via HMAC. The frontend fetches a token from GET /csrf-token,
  // stores it in memory, and sends it as X-CSRF-Token on mutations.
  await app.register(fastifyCsrf, {
    sessionPlugin: "@fastify/cookie",
    cookieOpts: {
      httpOnly: true,
      sameSite: "lax",
      secure: env.SECURE_SITE === "true",
      path: "/",
      signed: false,
    },
    getToken: (req) => req.headers["x-csrf-token"] as string,
    csrfOpts: {
      hmacKey: env.CSRF_SECRET,
    },
  });

  // CSRF token endpoint — returns a fresh token + sets the secret cookie
  app.get(
    "/csrf-token",
    {
      config: {
        rateLimit: { max: 30, timeWindow: "1 minute" },
      },
    },
    async (_request, reply) => {
      const token = reply.generateCsrf();
      return reply.send({ token });
    },
  );

  // ── Global CSRF enforcement hook ───────────────────────────
  // Skips safe methods and public unauthenticated mutation endpoints.
  // Everything else must present a valid X-CSRF-Token header.
  //
  // Primary mechanism: per-route `config: { csrfExempt: true }` (type-safe, co-located).
  // Fallback: CSRF_EXEMPT_ROUTES Set (for routes registered outside app modules, e.g.
  // /csrf-token, /health). Imported from ./config/csrf.config.js so tests can verify.

  app.addHook("onRequest", (request, reply, done) => {
    const method = request.method.toUpperCase();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
      return done();
    }

    // Per-route config is the primary exemption mechanism (type-safe, co-located
    // with the route definition). Checked first — no URL parsing needed.
    if (request.routeOptions.config?.csrfExempt === true) {
      return done();
    }

    // Fallback: static exempt set for routes that don't go through module route files
    // (e.g. /csrf-token, /health, /auth/refresh registered directly in app.ts).
    // Strip query string for route matching, then normalize trailing slash.
    // ignoreTrailingSlash:true means "/path/" and "/path" both reach the same handler,
    // so we must normalize before the Set lookup to prevent a trailing-slash bypass.
    const rawUrl = request.url.split("?")[0];
    const url = rawUrl.endsWith("/") && rawUrl.length > 1 ? rawUrl.slice(0, -1) : rawUrl;

    if (CSRF_EXEMPT_ROUTES.has(url)) {
      return done();
    }

    // Delegate to the plugin's callback-based csrfProtection(req, reply, next).
    // On success it calls done(); on failure it calls reply.send(error) directly.
    app.csrfProtection(request, reply, done);
  });

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
