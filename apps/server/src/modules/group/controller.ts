import type { FastifyReply, FastifyRequest } from "fastify";

import { AddMemberSchema, CreateGroupSchema, UpdateGroupSchema } from "./dto.js";
import { GroupService } from "./service.js";

/** Convert BigInt fields to JSON-safe strings */
function serializeGroup<
  T extends {
    maxFileSizeOverride?: bigint | null;
    maxTotalStorageOverride?: bigint | null;
    storageUsed?: bigint;
  },
>(group: T) {
  return {
    ...group,
    maxFileSizeOverride:
      group.maxFileSizeOverride != null ? String(group.maxFileSizeOverride) : null,
    maxTotalStorageOverride:
      group.maxTotalStorageOverride != null ? String(group.maxTotalStorageOverride) : null,
    ...(group.storageUsed !== undefined ? { storageUsed: String(group.storageUsed) } : {}),
  };
}

function serializeMember<T extends { storageUsed?: bigint }>(member: T) {
  return {
    ...member,
    ...(member.storageUsed !== undefined ? { storageUsed: String(member.storageUsed) } : {}),
  };
}

export class GroupController {
  private groupService = new GroupService();

  async listGroups(_request: FastifyRequest, reply: FastifyReply) {
    const groups = await this.groupService.listGroups();
    return reply.send(groups.map(serializeGroup));
  }

  async getGroup(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    const group = await this.groupService.getGroupDetail(id);
    const serialized = serializeGroup(group);
    return reply.send({
      ...serialized,
      members: group.members.map(serializeMember),
    });
  }

  async createGroup(request: FastifyRequest, reply: FastifyReply) {
    const input = CreateGroupSchema.parse(request.body);
    const group = await this.groupService.createGroup(input);
    return reply.status(201).send(serializeGroup(group));
  }

  async updateGroup(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    const input = UpdateGroupSchema.parse(request.body);
    const group = await this.groupService.updateGroup(id, input);
    return reply.send(serializeGroup(group));
  }

  async deleteGroup(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    const result = await this.groupService.deleteGroup(id);
    return reply.send({ message: "Group deleted", unassignedCount: result.unassignedCount });
  }

  async addMember(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    const { userId } = AddMemberSchema.parse(request.body);
    const result = await this.groupService.addMember(id, userId);
    return reply.send({
      message: "Member added to group",
      previousGroupId: result.previousGroupId ?? null,
    });
  }

  async removeMember(request: FastifyRequest, reply: FastifyReply) {
    const { id, userId } = request.params as { id: string; userId: string };
    await this.groupService.removeMember(id, userId);
    return reply.send({ message: "Member removed from group" });
  }
}
