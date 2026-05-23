import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { createAdminPreValidation } from "../../middleware/admin-prevalidation.js";
import { ErrorResponseSchema } from "../../utils/error-response-schema.js";
import { getLogger } from "../../utils/logger.js";
import { logAuditEvent } from "../audit/service.js";
import { AddMemberSchema, CreateGroupSchema, UpdateGroupSchema } from "./dto.js";
import { GroupService } from "./service.js";

const adminPreValidation = createAdminPreValidation({ allowSetupBypass: false });

const groupService = new GroupService();

const GroupResponseFields = {
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  maxFileSizeOverride: z.union([z.string(), z.null()]),
  maxTotalStorageOverride: z.union([z.string(), z.null()]),
  ldapDn: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
};

const GroupListItemSchema = z.object({
  ...GroupResponseFields,
  memberCount: z.number(),
  storageUsed: z.string(),
});

const MemberSchema = z.object({
  id: z.string(),
  username: z.string(),
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  image: z.string().nullable(),
  storageUsed: z.string(),
});

const GroupDetailSchema = z.object({
  ...GroupResponseFields,
  members: z.array(MemberSchema),
});

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
    storageUsed: String(member.storageUsed ?? 0n),
  };
}

export const groupRoutes: FastifyPluginAsyncZod = async (app) => {
  // GET /groups — list all groups
  app.route({
    method: "GET",
    url: "/groups",
    preValidation: adminPreValidation,
    schema: {
      tags: ["Group"],
      operationId: "listGroups",
      summary: "List All Groups",
      description: "List all groups with member counts and storage usage (admin only)",
      response: {
        200: z.array(GroupListItemSchema),
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
      },
    },
    handler: async (_request, reply) => {
      const groups = await groupService.listGroups();
      return reply.send(groups.map(serializeGroup));
    },
  });

  // GET /groups/:id — group detail with members
  app.route({
    method: "GET",
    url: "/groups/:id",
    preValidation: adminPreValidation,
    schema: {
      tags: ["Group"],
      operationId: "getGroup",
      summary: "Get Group Details",
      description: "Get group details with member list (admin only)",
      params: z.object({ id: z.string() }),
      response: {
        200: GroupDetailSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const group = await groupService.getGroupDetail(request.params.id);
      const serialized = serializeGroup(group);
      return reply.send({
        ...serialized,
        members: group.members.map(serializeMember),
      });
    },
  });

  // POST /groups — create group
  app.route({
    method: "POST",
    url: "/groups",
    preValidation: adminPreValidation,
    schema: {
      tags: ["Group"],
      operationId: "createGroup",
      summary: "Create Group",
      description: "Create a new group (admin only)",
      body: CreateGroupSchema,
      response: {
        201: z.object(GroupResponseFields),
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const group = await groupService.createGroup(request.body);
      logAuditEvent({
        userId: request.user?.userId,
        action: "GROUP_CREATE",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        targetType: "group",
        targetId: group.id,
        metadata: { name: request.body.name },
      }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));
      return reply.status(201).send(serializeGroup(group));
    },
  });

  // PUT /groups/:id — update group
  app.route({
    method: "PUT",
    url: "/groups/:id",
    preValidation: adminPreValidation,
    schema: {
      tags: ["Group"],
      operationId: "updateGroup",
      summary: "Update Group",
      description: "Update a group (admin only)",
      params: z.object({ id: z.string() }),
      body: UpdateGroupSchema,
      response: {
        200: z.object(GroupResponseFields),
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const group = await groupService.updateGroup(request.params.id, request.body);
      logAuditEvent({
        userId: request.user?.userId,
        action: "GROUP_UPDATE",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        targetType: "group",
        targetId: request.params.id,
      }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));
      return reply.send(serializeGroup(group));
    },
  });

  // DELETE /groups/:id — delete group
  app.route({
    method: "DELETE",
    url: "/groups/:id",
    preValidation: adminPreValidation,
    schema: {
      tags: ["Group"],
      operationId: "deleteGroup",
      summary: "Delete Group",
      description: "Delete a group (members are unassigned via SET NULL, admin only)",
      params: z.object({ id: z.string() }),
      response: {
        200: z.object({
          message: z.string(),
          unassignedCount: z.number(),
        }),
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const result = await groupService.deleteGroup(request.params.id);
      logAuditEvent({
        userId: request.user?.userId,
        action: "GROUP_DELETE",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        targetType: "group",
        targetId: request.params.id,
        metadata: { unassignedCount: result.unassignedCount },
      }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));
      return reply.send({ message: "Group deleted", unassignedCount: result.unassignedCount });
    },
  });

  // POST /groups/:id/members — add member
  app.route({
    method: "POST",
    url: "/groups/:id/members",
    preValidation: adminPreValidation,
    schema: {
      tags: ["Group"],
      operationId: "addGroupMember",
      summary: "Add Member to Group",
      description: "Add a user to a group. If user is in another group, they are moved.",
      params: z.object({ id: z.string() }),
      body: AddMemberSchema,
      response: {
        200: z.object({
          message: z.string(),
          previousGroupId: z.string().nullable(),
        }),
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const result = await groupService.addMember(request.params.id, request.body.userId);
      logAuditEvent({
        userId: request.user?.userId,
        action: "GROUP_MEMBER_ADD",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        targetType: "group",
        targetId: request.params.id,
        metadata: {
          memberId: request.body.userId,
          previousGroupId: result.previousGroupId ?? null,
        },
      }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));
      return reply.send({
        message: "Member added to group",
        previousGroupId: result.previousGroupId ?? null,
      });
    },
  });

  // DELETE /groups/:id/members/:userId — remove member
  app.route({
    method: "DELETE",
    url: "/groups/:id/members/:userId",
    preValidation: adminPreValidation,
    schema: {
      tags: ["Group"],
      operationId: "removeGroupMember",
      summary: "Remove Member from Group",
      description: "Remove a user from a group (admin only)",
      params: z.object({
        id: z.string(),
        userId: z.string(),
      }),
      response: {
        200: z.object({ message: z.string() }),
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      await groupService.removeMember(request.params.id, request.params.userId);
      logAuditEvent({
        userId: request.user?.userId,
        action: "GROUP_MEMBER_REMOVE",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        targetType: "group",
        targetId: request.params.id,
        metadata: { memberId: request.params.userId },
      }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));
      return reply.send({ message: "Member removed from group" });
    },
  });
};
