/**
 * Augment @fastify/jwt's FastifyJWT interface so that request.user is typed
 * with the application-specific JWT payload shape.
 *
 * @fastify/jwt derives `FastifyRequest.user` from `FastifyJWT.user` via
 * declaration merging. Declaring it here causes `UserType` to resolve to our
 * shape instead of the default `string | object | Buffer`.
 */
declare module "@fastify/jwt" {
  interface FastifyJWT {
    /**
     * The decoded JWT payload set by jwtVerify(). Only application-specific
     * claims are typed here; standard JWT claims (iat, exp, ...) are handled
     * transparently by the library.
     */
    user: {
      userId: string;
      isAdmin: boolean;
      tokenVersion: number;
    };
  }
}

/**
 * Augment Fastify's route config type to support per-route CSRF exemption.
 *
 * Routes that set `config: { csrfExempt: true }` are skipped by the global
 * CSRF onRequest hook. This replaces the fragile centralized CSRF_EXEMPT_DYNAMIC
 * list with a type-safe, co-located configuration.
 */
declare module "fastify" {
  interface FastifyContextConfig {
    csrfExempt?: boolean;
  }
}

// Required: makes this file an ES module so `declare module` performs
// augmentation (merging) rather than ambient module declaration.
export {};
