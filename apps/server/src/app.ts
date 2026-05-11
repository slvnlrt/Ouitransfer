import * as http from "node:http";
import fastifyCookie from "@fastify/cookie";
import { fastifyCors } from "@fastify/cors";
import fastifyCsrf from "@fastify/csrf-protection";
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
    // Validate tokenVersion on every jwtVerify() call.
    // Returning false causes jwtVerify to throw "Untrusted token".
    trusted: validateTokenVersion,
  });

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

  /** Exact routes exempt from CSRF (public unauthenticated mutations). */
  const CSRF_EXEMPT_ROUTES = new Set([
    "/auth/login",
    "/auth/forgot-password",
    "/auth/reset-password",
    "/auth/2fa/login",
    "/register-with-invite",
    "/health",
    "/csrf-token",
  ]);

  /**
   * Prefix + suffix patterns for public endpoints with dynamic segments.
   * Each entry: [prefix, test function for the rest of the URL].
   */
  const CSRF_EXEMPT_DYNAMIC: Array<(url: string) => boolean> = [
    // POST /shares/:shareId/access
    (url) => url.startsWith("/shares/") && url.endsWith("/access"),
    // POST /shares/alias/:alias/access
    (url) => url.startsWith("/shares/alias/") && url.endsWith("/access"),
    // POST /reverse-shares/alias/:alias/* (public upload flow)
    (url) => url.startsWith("/reverse-shares/alias/"),
    // POST /reverse-shares/:id/presigned-url
    (url) => url.startsWith("/reverse-shares/") && url.endsWith("/presigned-url"),
    // POST /reverse-shares/:id/register-file
    (url) => url.startsWith("/reverse-shares/") && url.endsWith("/register-file"),
    // POST /reverse-shares/:id/check-password
    (url) => url.startsWith("/reverse-shares/") && url.endsWith("/check-password"),
    // POST /reverse-shares/:id/upload/access (anonymous upload to password-protected reverse share)
    (url) => url.startsWith("/reverse-shares/") && url.endsWith("/upload/access"),
  ];

  app.addHook("onRequest", (request, reply, done) => {
    const method = request.method.toUpperCase();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
      return done();
    }

    // Strip query string for route matching, then normalize trailing slash.
    // ignoreTrailingSlash:true means "/path/" and "/path" both reach the same handler,
    // so we must normalize before the Set lookup to prevent a trailing-slash bypass.
    const rawUrl = request.url.split("?")[0];
    const url = rawUrl.endsWith("/") && rawUrl.length > 1 ? rawUrl.slice(0, -1) : rawUrl;

    if (CSRF_EXEMPT_ROUTES.has(url)) {
      return done();
    }

    for (const test of CSRF_EXEMPT_DYNAMIC) {
      if (test(url)) {
        return done();
      }
    }

    // Delegate to the plugin's callback-based csrfProtection(req, reply, next).
    // On success it calls done(); on failure it calls reply.send(error) directly.
    app.csrfProtection(request, reply, done);
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
