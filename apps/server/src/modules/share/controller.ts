import type { FastifyReply, FastifyRequest } from "fastify";

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
    try {
      await request.jwtVerify();
      const userId = request.user?.userId;
      if (!userId) {
        return reply
          .status(401)
          .send({ error: "Unauthorized: a valid token is required to access this resource." });
      }

      const input = CreateShareSchema.parse(request.body);
      const share = await this.shareService.createShare(input, userId);
      return reply.status(201).send({ share });
    } catch (error: unknown) {
      request.log.error({ err: error }, "Create Share Error");
      if (error instanceof Error && "errors" in error) {
        return reply.status(400).send({ error: (error as { errors: unknown }).errors });
      }
      const message = error instanceof Error ? error.message : "Unknown error occurred";
      return reply.status(400).send({ error: message });
    }
  }

  async listUserShares(request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify();
      const userId = request.user?.userId;
      if (!userId) {
        return reply
          .status(401)
          .send({ error: "Unauthorized: a valid token is required to access this resource." });
      }

      const shares = await this.shareService.listUserShares(userId);
      return reply.send({ shares });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send({ error: message });
    }
  }

  async getShare(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { shareId } = request.params as { shareId: string };
      const password = (request.body as { password?: string } | null)?.password;

      let userId: string | undefined;
      try {
        await request.jwtVerify();
        userId = request.user?.userId;
      } catch (err) {
        request.log.error({ err }, "JWT verification failed");
      }

      const share = await this.shareService.getShare(shareId, password, userId);
      return reply.send({ share });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "Share not found") {
        return reply.status(404).send({ error: message });
      }
      if (message === "Share has reached maximum views") {
        return reply.status(403).send({ error: message });
      }
      if (message === "Share has expired") {
        return reply.status(410).send({ error: message });
      }
      return reply.status(400).send({ error: message });
    }
  }

  async updateShare(request: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = request.user?.userId;
      if (!userId) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      const { id, ...updateData } = UpdateShareSchema.parse(request.body);
      const share = await this.shareService.updateShare(id, updateData, userId);
      return reply.send({ share });
    } catch (error: unknown) {
      request.log.error({ err: error }, "Update Share Error");
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send({ error: message });
    }
  }

  async updatePassword(request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify();
      const userId = request.user?.userId;
      if (!userId) {
        return reply
          .status(401)
          .send({ error: "Unauthorized: a valid token is required to access this resource." });
      }

      const { shareId } = request.params as { shareId: string };
      const { password } = UpdateSharePasswordSchema.parse(request.body);

      const share = await this.shareService.updateSharePassword(shareId, userId, password);
      return reply.send({ share });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "Share not found") {
        return reply.status(404).send({ error: message });
      }
      if (message === "Unauthorized to update this share") {
        return reply.status(401).send({ error: message });
      }
      return reply.status(400).send({ error: message });
    }
  }

  async addItems(request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify();
      const userId = request.user?.userId;
      if (!userId) {
        return reply
          .status(401)
          .send({ error: "Unauthorized: a valid token is required to access this resource." });
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
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "Share not found") {
        return reply.status(404).send({ error: message });
      }
      if (message === "Unauthorized to update this share") {
        return reply.status(401).send({ error: message });
      }
      if (message.startsWith("Files not found:") || message.startsWith("Folders not found:")) {
        return reply.status(404).send({ error: message });
      }
      return reply.status(400).send({ error: message });
    }
  }

  async removeItems(request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify();
      const userId = request.user?.userId;
      if (!userId) {
        return reply
          .status(401)
          .send({ error: "Unauthorized: a valid token is required to access this resource." });
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
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "Share not found") {
        return reply.status(404).send({ error: message });
      }
      if (message === "Unauthorized to update this share") {
        return reply.status(401).send({ error: message });
      }
      return reply.status(400).send({ error: message });
    }
  }

  async deleteShare(request: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = request.user?.userId;
      if (!userId) {
        return reply
          .status(401)
          .send({ error: "Unauthorized: a valid token is required to access this resource." });
      }

      const { id } = request.params as { id: string };

      const share = await this.shareService.findShareById(id);
      if (!share) {
        return reply.status(404).send({ error: "Share not found" });
      }

      if (share.creatorId !== userId) {
        return reply.status(401).send({ error: "Unauthorized to delete this share" });
      }

      const deleted = await this.shareService.deleteShare(id);
      return reply.send({ share: deleted });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send({ error: message });
    }
  }

  async addRecipients(request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify();
      const userId = request.user?.userId;
      if (!userId) {
        return reply
          .status(401)
          .send({ error: "Unauthorized: a valid token is required to access this resource." });
      }

      const { shareId } = request.params as { shareId: string };
      const { emails } = UpdateShareRecipientsSchema.parse(request.body);

      const share = await this.shareService.addRecipients(shareId, userId, emails);
      return reply.send({ share });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "Share not found") {
        return reply.status(404).send({ error: message });
      }
      if (message === "Unauthorized to update this share") {
        return reply.status(401).send({ error: message });
      }
      return reply.status(400).send({ error: message });
    }
  }

  async removeRecipients(request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify();
      const userId = request.user?.userId;
      if (!userId) {
        return reply
          .status(401)
          .send({ error: "Unauthorized: a valid token is required to access this resource." });
      }

      const { shareId } = request.params as { shareId: string };
      const { emails } = UpdateShareRecipientsSchema.parse(request.body);

      const share = await this.shareService.removeRecipients(shareId, userId, emails);
      return reply.send({ share });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "Share not found") {
        return reply.status(404).send({ error: message });
      }
      if (message === "Unauthorized to update this share") {
        return reply.status(401).send({ error: message });
      }
      return reply.status(400).send({ error: message });
    }
  }

  async createOrUpdateAlias(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { shareId } = request.params as { shareId: string };
      const { alias } = request.body as { alias: string };
      const userId = request.user?.userId;

      const result = await this.shareService.createOrUpdateAlias(shareId, alias, userId);
      return reply.send({ alias: result });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send({ error: message });
    }
  }

  async getShareByAlias(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { alias } = request.params as { alias: string };
      const password = (request.body as { password?: string } | null)?.password;

      const share = await this.shareService.getShareByAlias(alias, password);
      return reply.send({ share });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "Share not found") {
        return reply.status(404).send({ error: message });
      }
      return reply.status(400).send({ error: message });
    }
  }

  async notifyRecipients(request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify();
      const userId = request.user?.userId;
      if (!userId) {
        return reply
          .status(401)
          .send({ error: "Unauthorized: a valid token is required to access this resource." });
      }

      const { shareId } = request.params as { shareId: string };
      const { shareLink } = request.body as { shareLink: string };

      const result = await this.shareService.notifyRecipients(shareId, userId, shareLink);
      return reply.send(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "Share not found") {
        return reply.status(404).send({ error: message });
      }
      if (message === "Unauthorized to access this share") {
        return reply.status(401).send({ error: message });
      }
      if (message === "SMTP is not enabled") {
        return reply.status(400).send({ error: message });
      }
      return reply.status(400).send({ error: message });
    }
  }

  async getShareMetadataByAlias(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { alias } = request.params as { alias: string };
      const metadata = await this.shareService.getShareMetadataByAlias(alias);
      return reply.send(metadata);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "Share not found") {
        return reply.status(404).send({ error: message });
      }
      return reply.status(400).send({ error: message });
    }
  }
}
