import type { FastifyRequest } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    /**
     * Método decorado para assinar um payload JWT.
     * @param payload - Objeto que será assinado.
     * @param options - Opções adicionais para a assinatura.
     * @returns O token JWT assinado.
     */
    jwtSign(payload: object, options?: object): string;
  }
}

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
     * claims are typed here; standard JWT claims (iat, exp, …) are handled
     * transparently by the library.
     */
    user: {
      userId: string;
      isAdmin: boolean;
    };
  }
}
