import type { FastifyReply, FastifyRequest } from "fastify";
import {
  REFRESH_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_COOKIE_PATH,
  REFRESH_TOKEN_MAX_AGE,
} from "../../config/auth.config.js";
import { env } from "../../env.js";
import { UnauthorizedError } from "../../utils/app-error.js";
import { getLogger } from "../../utils/logger.js";
import { logAuditEvent } from "../audit/service.js";
import { ConfigService } from "../config/service.js";
import { createChallengeToken, verifyChallengeToken } from "./challenge.js";
import {
  CompleteTwoFactorLoginSchema,
  createResetPasswordSchema,
  type LoginInput,
  RequestPasswordResetSchema,
} from "./dto.js";
import { createRefreshToken, revokeAllUserTokens } from "./refresh-token.service.js";
import { AuthService } from "./service.js";

export class AuthController {
  private authService = new AuthService();
  private configService = new ConfigService();

  private getClientInfo(request: FastifyRequest) {
    const realIP = request.headers["x-real-ip"] as string;
    const realUserAgent = request.headers["x-user-agent"] as string;

    const userAgent = realUserAgent || request.headers["user-agent"] || "";
    const ipAddress = realIP || request.ip || request.socket.remoteAddress || "";

    return { userAgent, ipAddress };
  }

  async login(request: FastifyRequest, reply: FastifyReply) {
    const input = request.body as LoginInput;
    const { userAgent, ipAddress } = this.getClientInfo(request);

    let result: Awaited<ReturnType<AuthService["login"]>>;
    try {
      result = await this.authService.login(input, userAgent, ipAddress);
    } catch (err) {
      // Audit failed login (fire-and-forget)
      logAuditEvent({
        action: "LOGIN_FAILURE",
        ipAddress,
        userAgent,
        metadata: { emailOrUsername: input.emailOrUsername },
      }).catch((auditErr) => getLogger().error({ err: auditErr }, "Audit log write failed"));
      throw err;
    }

    if ("requiresTwoFactor" in result) {
      const challengeToken = await createChallengeToken(result.userId);
      return reply.send({
        requiresTwoFactor: true,
        challengeToken,
        message: result.message,
      });
    }

    const user = result;
    const isSecure = env.SECURE_SITE === "true";

    const token = await reply.jwtSign({
      userId: user.id,
      isAdmin: user.isAdmin,
      tokenVersion: user.tokenVersion,
    });

    // signed: true — the token cookie is signed by @fastify/cookie so that
    // @fastify/jwt can verify its integrity via request.unsignCookie() on read.
    reply.setCookie("token", token, {
      httpOnly: true,
      path: "/",
      secure: isSecure,
      sameSite: isSecure ? "lax" : "strict",
      signed: true,
    });

    // Issue refresh token as httpOnly cookie (same approach as OIDC callback).
    // signed: false — the refresh token is an opaque value looked up in the DB;
    // its integrity is guaranteed by the DB record, not by cookie signing.
    const refreshToken = await createRefreshToken(user.id, userAgent, ipAddress);
    reply.setCookie(REFRESH_TOKEN_COOKIE_NAME, refreshToken, {
      httpOnly: true,
      secure: isSecure,
      sameSite: "lax",
      path: REFRESH_TOKEN_COOKIE_PATH,
      maxAge: REFRESH_TOKEN_MAX_AGE,
      signed: false,
    });

    // Audit successful login (fire-and-forget)
    logAuditEvent({
      userId: user.id,
      action: "LOGIN_SUCCESS",
      ipAddress,
      userAgent,
    }).catch((auditErr) => getLogger().error({ err: auditErr }, "Audit log write failed"));

    return reply.send({ user });
  }

  async completeTwoFactorLogin(request: FastifyRequest, reply: FastifyReply) {
    const input = CompleteTwoFactorLoginSchema.parse(request.body);

    // Verify the challenge token instead of trusting a raw userId
    const userId = await verifyChallengeToken(input.challengeToken);

    const { userAgent, ipAddress } = this.getClientInfo(request);
    const user = await this.authService.completeTwoFactorLogin(
      userId,
      input.token,
      input.rememberDevice,
      userAgent,
      ipAddress,
    );

    const isSecure = env.SECURE_SITE === "true";

    const token = await reply.jwtSign({
      userId: user.id,
      isAdmin: user.isAdmin,
      tokenVersion: user.tokenVersion,
    });

    // signed: true — the token cookie is signed by @fastify/cookie so that
    // @fastify/jwt can verify its integrity via request.unsignCookie() on read.
    reply.setCookie("token", token, {
      httpOnly: true,
      path: "/",
      secure: isSecure,
      sameSite: isSecure ? "lax" : "strict",
      signed: true,
    });

    // Issue refresh token as httpOnly cookie (same approach as OIDC callback).
    // signed: false — the refresh token is an opaque value looked up in the DB;
    // its integrity is guaranteed by the DB record, not by cookie signing.
    const refreshToken = await createRefreshToken(user.id, userAgent, ipAddress);
    reply.setCookie(REFRESH_TOKEN_COOKIE_NAME, refreshToken, {
      httpOnly: true,
      secure: isSecure,
      sameSite: "lax",
      path: REFRESH_TOKEN_COOKIE_PATH,
      maxAge: REFRESH_TOKEN_MAX_AGE,
      signed: false,
    });

    // Audit successful 2FA login (fire-and-forget)
    logAuditEvent({
      userId: user.id,
      action: "LOGIN_SUCCESS",
      ipAddress,
      userAgent,
      metadata: { method: "2fa" },
    }).catch((auditErr) => getLogger().error({ err: auditErr }, "Audit log write failed"));

    return reply.send({ user });
  }

  async logout(request: FastifyRequest, reply: FastifyReply) {
    const { userAgent, ipAddress } = this.getClientInfo(request);

    // Try to get userId from JWT for audit logging (may fail if token expired)
    let userId: string | undefined;
    try {
      await request.jwtVerify();
      userId = request.user?.userId;
    } catch {
      // Token may be expired or invalid — still proceed with logout
    }

    reply.clearCookie("token", { path: "/" });
    reply.clearCookie(REFRESH_TOKEN_COOKIE_NAME, { path: REFRESH_TOKEN_COOKIE_PATH });

    // Revoke all refresh tokens for this user so stolen tokens cannot be reused
    if (userId) {
      revokeAllUserTokens(userId).catch((err) =>
        getLogger().error({ err }, "Failed to revoke refresh tokens on logout"),
      );
    }

    // Audit logout (fire-and-forget)
    logAuditEvent({
      userId,
      action: "LOGOUT",
      ipAddress,
      userAgent,
    }).catch((auditErr) => getLogger().error({ err: auditErr }, "Audit log write failed"));

    return reply.send({ message: "Logout successful" });
  }

  async requestPasswordReset(request: FastifyRequest, reply: FastifyReply) {
    const { email, origin } = RequestPasswordResetSchema.parse(request.body);
    await this.authService.requestPasswordReset(email, origin);
    return reply.send({
      message: "If an account exists with this email, a password reset link will be sent.",
    });
  }

  async resetPassword(request: FastifyRequest, reply: FastifyReply) {
    const schema = await createResetPasswordSchema();
    const input = schema.parse(request.body);
    const { userAgent, ipAddress } = this.getClientInfo(request);

    const { userId } = await this.authService.resetPassword(input.token, input.password);

    // Audit password reset (fire-and-forget)
    logAuditEvent({
      userId,
      action: "PASSWORD_RESET",
      ipAddress,
      userAgent,
    }).catch((auditErr) => getLogger().error({ err: auditErr }, "Audit log write failed"));

    return reply.send({ message: "Password reset successfully" });
  }

  async getCurrentUser(request: FastifyRequest, reply: FastifyReply) {
    let userId: string | null = null;
    try {
      await request.jwtVerify();
      userId = request.user?.userId;
    } catch (_err) {
      // Not authenticated — return null user (this is expected behavior, not an error)
      return reply.send({ user: null });
    }

    if (!userId) {
      return reply.send({ user: null });
    }

    const user = await this.authService.getUserById(userId);
    if (!user) {
      return reply.send({ user: null });
    }

    return reply.send({ user });
  }

  async getTrustedDevices(request: FastifyRequest, reply: FastifyReply) {
    const userId = request.user?.userId;
    if (!userId) {
      throw new UnauthorizedError(
        "Unauthorized: a valid token is required to access this resource.",
      );
    }

    const devices = await this.authService.getTrustedDevices(userId);
    return reply.send({ devices });
  }

  async removeTrustedDevice(request: FastifyRequest, reply: FastifyReply) {
    const userId = request.user?.userId;
    if (!userId) {
      throw new UnauthorizedError(
        "Unauthorized: a valid token is required to access this resource.",
      );
    }

    const { id } = request.params as { id: string };
    await this.authService.removeTrustedDevice(userId, id);
    return reply.send({ success: true, message: "Trusted device removed successfully" });
  }

  async removeAllTrustedDevices(request: FastifyRequest, reply: FastifyReply) {
    const userId = request.user?.userId;
    if (!userId) {
      throw new UnauthorizedError(
        "Unauthorized: a valid token is required to access this resource.",
      );
    }

    const result = await this.authService.removeAllTrustedDevices(userId);
    return reply.send(result);
  }

  async getAuthConfig(_request: FastifyRequest, reply: FastifyReply) {
    const passwordAuthEnabled = await this.configService.getValue("passwordAuthEnabled");
    return reply.send({
      passwordAuthEnabled: passwordAuthEnabled === "true",
    });
  }
}
