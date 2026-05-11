import type { FastifyReply, FastifyRequest } from "fastify";

import { NotFoundError, UnauthorizedError } from "../../utils/app-error.js";
import {
  CreateShareSchema,
  UpdateShareItemsSchema,
  UpdateSharePasswordSchema,
  UpdateShareRecipientsSchema,
  UpdateShareSchema,
} from "./dto.js";
import { ShareService } from "./service.js";

export class ShareController {
  private shareService = new ShareService();

  async createShare(request: FastifyRequest, reply: FastifyReply) {
    await request.jwtVerify();
    const userId = request.user?.userId;
    if (!userId) {
      throw new UnauthorizedError(
        "Unauthorized: a valid token is required to access this resource.",
      );
    }

    const input = CreateShareSchema.parse(request.body);
    const share = await this.shareService.createShare(input, userId);
    return reply.status(201).send({ share });
  }

  async listUserShares(request: FastifyRequest, reply: FastifyReply) {
    await request.jwtVerify();
    const userId = request.user?.userId;
    if (!userId) {
      throw new UnauthorizedError(
        "Unauthorized: a valid token is required to access this resource.",
      );
    }

    const shares = await this.shareService.listUserShares(userId);
    return reply.send({ shares });
  }

  async getShare(request: FastifyRequest, reply: FastifyReply) {
    const { shareId } = request.params as { shareId: string };
    const password = (request.body as { password?: string } | null)?.password;

    let userId: string | undefined;
    try {
      await request.jwtVerify();
      userId = request.user?.userId;
    } catch (err) {
      // JWT verification failure is expected for unauthenticated share access
      request.log.error({ err }, "JWT verification failed");
    }

    const share = await this.shareService.getShare(shareId, password, userId);
    return reply.send({ share });
  }

  async updateShare(request: FastifyRequest, reply: FastifyReply) {
    const userId = request.user?.userId;
    if (!userId) {
      throw new UnauthorizedError();
    }

    const { id, ...updateData } = UpdateShareSchema.parse(request.body);
    const share = await this.shareService.updateShare(id, updateData, userId);
    return reply.send({ share });
  }

  async updatePassword(request: FastifyRequest, reply: FastifyReply) {
    await request.jwtVerify();
    const userId = request.user?.userId;
    if (!userId) {
      throw new UnauthorizedError(
        "Unauthorized: a valid token is required to access this resource.",
      );
    }

    const { shareId } = request.params as { shareId: string };
    const { password } = UpdateSharePasswordSchema.parse(request.body);

    const share = await this.shareService.updateSharePassword(shareId, userId, password);
    return reply.send({ share });
  }

  async addItems(request: FastifyRequest, reply: FastifyReply) {
    await request.jwtVerify();
    const userId = request.user?.userId;
    if (!userId) {
      throw new UnauthorizedError(
        "Unauthorized: a valid token is required to access this resource.",
      );
    }

    const { shareId } = request.params as { shareId: string };
    const { files, folders } = UpdateShareItemsSchema.parse(request.body);

    const share = await this.shareService.addItemsToShare(
      shareId,
      userId,
      files || [],
      folders || [],
    );
    return reply.send({ share });
  }

  async removeItems(request: FastifyRequest, reply: FastifyReply) {
    await request.jwtVerify();
    const userId = request.user?.userId;
    if (!userId) {
      throw new UnauthorizedError(
        "Unauthorized: a valid token is required to access this resource.",
      );
    }

    const { shareId } = request.params as { shareId: string };
    const { files, folders } = UpdateShareItemsSchema.parse(request.body);

    const share = await this.shareService.removeItemsFromShare(
      shareId,
      userId,
      files || [],
      folders || [],
    );
    return reply.send({ share });
  }

  async deleteShare(request: FastifyRequest, reply: FastifyReply) {
    const userId = request.user?.userId;
    if (!userId) {
      throw new UnauthorizedError(
        "Unauthorized: a valid token is required to access this resource.",
      );
    }

    const { id } = request.params as { id: string };

    const share = await this.shareService.findShareById(id);
    if (!share) {
      throw new NotFoundError("Share not found");
    }

    if (share.creatorId !== userId) {
      throw new UnauthorizedError("Unauthorized to delete this share");
    }

    const deleted = await this.shareService.deleteShare(id);
    return reply.send({ share: deleted });
  }

  async addRecipients(request: FastifyRequest, reply: FastifyReply) {
    await request.jwtVerify();
    const userId = request.user?.userId;
    if (!userId) {
      throw new UnauthorizedError(
        "Unauthorized: a valid token is required to access this resource.",
      );
    }

    const { shareId } = request.params as { shareId: string };
    const { emails } = UpdateShareRecipientsSchema.parse(request.body);

    const share = await this.shareService.addRecipients(shareId, userId, emails);
    return reply.send({ share });
  }

  async removeRecipients(request: FastifyRequest, reply: FastifyReply) {
    await request.jwtVerify();
    const userId = request.user?.userId;
    if (!userId) {
      throw new UnauthorizedError(
        "Unauthorized: a valid token is required to access this resource.",
      );
    }

    const { shareId } = request.params as { shareId: string };
    const { emails } = UpdateShareRecipientsSchema.parse(request.body);

    const share = await this.shareService.removeRecipients(shareId, userId, emails);
    return reply.send({ share });
  }

  async createOrUpdateAlias(request: FastifyRequest, reply: FastifyReply) {
    const { shareId } = request.params as { shareId: string };
    const { alias } = request.body as { alias: string };
    const userId = request.user?.userId;

    const result = await this.shareService.createOrUpdateAlias(shareId, alias, userId);
    return reply.send({ alias: result });
  }

  async getShareByAlias(request: FastifyRequest, reply: FastifyReply) {
    const { alias } = request.params as { alias: string };
    const password = (request.body as { password?: string } | null)?.password;

    const share = await this.shareService.getShareByAlias(alias, password);
    return reply.send({ share });
  }

  async notifyRecipients(request: FastifyRequest, reply: FastifyReply) {
    await request.jwtVerify();
    const userId = request.user?.userId;
    if (!userId) {
      throw new UnauthorizedError(
        "Unauthorized: a valid token is required to access this resource.",
      );
    }

    const { shareId } = request.params as { shareId: string };
    const { shareLink } = request.body as { shareLink: string };

    const result = await this.shareService.notifyRecipients(shareId, userId, shareLink);
    return reply.send(result);
  }

  async getShareMetadataByAlias(request: FastifyRequest, reply: FastifyReply) {
    const { alias } = request.params as { alias: string };
    const metadata = await this.shareService.getShareMetadataByAlias(alias);
    return reply.send(metadata);
  }
}
