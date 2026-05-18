import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { createAdminPreValidation } from "../../middleware/admin-prevalidation.js";
import { ErrorResponseSchema } from "../../utils/error-response-schema.js";
import { GroupController } from "./controller.js";

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

export async function groupRoutes(app: FastifyInstance) {
  const groupController = new GroupController();
  const adminPreValidation = createAdminPreValidation({ allowSetupBypass: false });

  // GET /groups — list all groups
  app.get(
    "/groups",
    {
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
    },
    groupController.listGroups.bind(groupController),
  );

  // GET /groups/:id — group detail with members
  app.get(
    "/groups/:id",
    {
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
    },
    groupController.getGroup.bind(groupController),
  );

  // POST /groups — create group
  app.post(
    "/groups",
    {
      preValidation: adminPreValidation,
      schema: {
        tags: ["Group"],
        operationId: "createGroup",
        summary: "Create Group",
        description: "Create a new group (admin only)",
        body: z.object({
          name: z.string().min(1).max(100).describe("Group name (unique, max 100 chars)"),
          description: z.string().max(500).optional().describe("Group description (max 500 chars)"),
          maxFileSizeOverride: z
            .union([z.number(), z.string(), z.null()])
            .optional()
            .describe("Per-member max file size override (null=inherit, 0=unlimited, >0=bytes)"),
          maxTotalStorageOverride: z
            .union([z.number(), z.string(), z.null()])
            .optional()
            .describe("Per-member max total storage override"),
        }),
        response: {
          201: z.object(GroupResponseFields),
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    groupController.createGroup.bind(groupController),
  );

  // PUT /groups/:id — update group
  app.put(
    "/groups/:id",
    {
      preValidation: adminPreValidation,
      schema: {
        tags: ["Group"],
        operationId: "updateGroup",
        summary: "Update Group",
        description: "Update a group (admin only)",
        params: z.object({ id: z.string() }),
        body: z.object({
          name: z.string().min(1).max(100).optional(),
          description: z.string().max(500).nullable().optional(),
          maxFileSizeOverride: z.union([z.number(), z.string(), z.null()]).optional(),
          maxTotalStorageOverride: z.union([z.number(), z.string(), z.null()]).optional(),
        }),
        response: {
          200: z.object(GroupResponseFields),
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    groupController.updateGroup.bind(groupController),
  );

  // DELETE /groups/:id — delete group
  app.delete(
    "/groups/:id",
    {
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
    },
    groupController.deleteGroup.bind(groupController),
  );

  // POST /groups/:id/members — add member
  app.post(
    "/groups/:id/members",
    {
      preValidation: adminPreValidation,
      schema: {
        tags: ["Group"],
        operationId: "addGroupMember",
        summary: "Add Member to Group",
        description: "Add a user to a group. If user is in another group, they are moved.",
        params: z.object({ id: z.string() }),
        body: z.object({
          userId: z.string().describe("User ID to add"),
        }),
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
    },
    groupController.addMember.bind(groupController),
  );

  // DELETE /groups/:id/members/:userId — remove member
  app.delete(
    "/groups/:id/members/:userId",
    {
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
    },
    groupController.removeMember.bind(groupController),
  );
}
