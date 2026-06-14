import { randomBytes } from "node:crypto";
import { ErrorCodes } from "@ouitransfer/shared/error-codes";
import bcrypt from "bcryptjs";

import { prisma } from "../../shared/prisma.js";
import { AppError, NotFoundError } from "../../utils/app-error.js";
import { getLogger } from "../../utils/logger.js";
import { BCRYPT_COST } from "../auth/password-policy.js";
import { emailService } from "../email/service.js";
import { buildInviteRegistrationUrl } from "../email/url-builder.js";

type InviteTokenVerdict = { valid: boolean; used?: boolean; expired?: boolean };

/** Lifetime of an invite token, in minutes. Also surfaced to the invitee's email. */
const INVITE_TOKEN_TTL_MINUTES = 15;

/**
 * Pure single-use/expiry evaluation for an invite token row. Shared between the
 * GET validate route and the registration flow so the rules never drift.
 */
function evaluateInviteToken(
  token: { usedAt: Date | null; expiresAt: Date } | null,
): InviteTokenVerdict {
  if (!token) {
    return { valid: false };
  }
  if (token.usedAt) {
    return { valid: false, used: true };
  }
  if (new Date() > token.expiresAt) {
    return { valid: false, expired: true };
  }
  return { valid: true };
}

/** Maps an invalid verdict to the matching structured error. */
function invalidInviteTokenError(verdict: InviteTokenVerdict): AppError {
  if (verdict.used) {
    return new AppError(
      409,
      "This invite link has already been used",
      ErrorCodes.INVITE_TOKEN_USED,
    );
  }
  if (verdict.expired) {
    return new AppError(410, "This invite link has expired", ErrorCodes.INVITE_TOKEN_EXPIRED);
  }
  return new NotFoundError("Invalid invite link");
}

export class InviteService {
  async generateInviteToken(
    adminUserId: string,
    email?: string,
  ): Promise<{
    id: string;
    token: string;
    expiresAt: Date;
    emailSent: boolean;
    registrationUrl: string | null;
  }> {
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + INVITE_TOKEN_TTL_MINUTES);

    const inviteToken = await prisma.inviteToken.create({
      data: {
        token,
        expiresAt,
        createdBy: adminUserId,
      },
    });

    const emailSent = email ? await this.sendInvitationEmail({ email, token, adminUserId }) : false;

    // Build the absolute link from the admin-configured appUrl so the link the
    // admin copies matches the one emailed to the invitee (the emailed link is
    // also appUrl-based). When appUrl is not configured, the builder throws; we
    // return null and let the client fall back to its own origin.
    let registrationUrl: string | null = null;
    try {
      registrationUrl = await buildInviteRegistrationUrl(token);
    } catch {
      registrationUrl = null;
    }

    return { id: inviteToken.id, token, expiresAt, emailSent, registrationUrl };
  }

  /**
   * Emails the self-registration link to a prospective user.
   *
   * The invitee has no account, so the inviting admin's locale is used as the
   * best available language signal (same approach as share invitations). The
   * link is built from the configured appUrl — `emailService.send` gates on SMTP
   * being enabled and returns `{ enqueued: false }` when it is off, which we
   * surface as `emailSent: false`.
   *
   * Never throws: a queueing failure must not fail token generation, since the
   * admin can still copy the link manually.
   */
  private async sendInvitationEmail(params: {
    email: string;
    token: string;
    adminUserId: string;
  }): Promise<boolean> {
    const { email, token, adminUserId } = params;
    try {
      const inviter = await prisma.user.findUnique({
        where: { id: adminUserId },
        select: { firstName: true, lastName: true, locale: true },
      });

      const inviterName = `${inviter?.firstName ?? ""} ${inviter?.lastName ?? ""}`.trim();
      const inviteLink = await buildInviteRegistrationUrl(token);

      const result = await emailService.send("user_invitation", {
        to: email,
        locale: inviter?.locale ?? "en",
        data: {
          inviterName,
          inviteLink,
          expiresInMinutes: INVITE_TOKEN_TTL_MINUTES,
        },
      });

      return result.enqueued;
    } catch (err) {
      getLogger().error({ err, email }, "Failed to queue user invitation email");
      return false;
    }
  }

  async validateInviteToken(token: string): Promise<InviteTokenVerdict> {
    return evaluateInviteToken(await prisma.inviteToken.findUnique({ where: { token } }));
  }

  async registerWithInvite(data: {
    token: string;
    firstName: string;
    lastName: string;
    username: string;
    email: string;
    password: string;
  }): Promise<{ id: string; username: string; email: string; inviteTokenId: string }> {
    // Fast-fail with friendly errors before the expensive bcrypt hash below.
    // This is a pre-flight check only — the authoritative single-use guard is
    // the atomic claim inside the transaction (closes the validate→update
    // TOCTOU race where two concurrent requests both pass validation, B-26).
    const preflightToken = await prisma.inviteToken.findUnique({ where: { token: data.token } });
    if (!preflightToken) {
      throw new NotFoundError("Invalid invite link");
    }
    const preflight = evaluateInviteToken(preflightToken);
    if (!preflight.valid) {
      throw invalidInviteTokenError(preflight);
    }

    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [{ username: data.username }, { email: data.email }],
      },
    });

    if (existingUser) {
      if (existingUser.username === data.username) {
        throw new AppError(409, "Username already exists", ErrorCodes.USERNAME_EXISTS);
      }
      if (existingUser.email === data.email) {
        throw new AppError(409, "Email already exists", ErrorCodes.EMAIL_EXISTS);
      }
    }

    const hashedPassword = await bcrypt.hash(data.password, BCRYPT_COST);
    const result = await prisma.$transaction(async (tx) => {
      // Atomically claim the token: the conditional `where` means only the
      // first concurrent request whose update still matches (unused, unexpired)
      // wins. A loser gets count === 0 and never creates a user.
      const claim = await tx.inviteToken.updateMany({
        where: { token: data.token, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });

      if (claim.count === 0) {
        // Lost the race or the token was invalidated between pre-flight and
        // claim. Re-read to surface the precise reason.
        const current = await tx.inviteToken.findUnique({ where: { token: data.token } });
        throw invalidInviteTokenError(evaluateInviteToken(current));
      }

      const user = await tx.user.create({
        data: {
          firstName: data.firstName,
          lastName: data.lastName,
          username: data.username,
          email: data.email,
          password: hashedPassword,
          isAdmin: false,
          isActive: true,
        },
        select: {
          id: true,
          username: true,
          email: true,
        },
      });

      // The token id is immutable; reuse the row fetched during pre-flight.
      return { ...user, inviteTokenId: preflightToken.id };
    });

    // Notify admins about new invite-based registration (fire-and-forget).
    // An admin created the invite, so there's always at least one user — but guard anyway.
    emailService
      .sendToAdmins("admin_user_registered", {
        userName: `${data.firstName} ${data.lastName}`.trim(),
        userEmail: data.email,
        registrationMethod: "invite",
      })
      .catch((err) =>
        getLogger().error({ err }, "Failed to send admin_user_registered email for invited user"),
      );

    return result;
  }
}
