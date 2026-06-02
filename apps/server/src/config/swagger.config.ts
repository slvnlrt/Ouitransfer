import { fastifySwagger } from "@fastify/swagger";
import type { FastifyInstance } from "fastify";
import { jsonSchemaTransform } from "fastify-type-provider-zod";

export function registerSwagger(app: FastifyInstance) {
  app.register(fastifySwagger, {
    openapi: {
      info: {
        title: "OUITRANSFER API",
        description: "API documentation for OUITRANSFER file sharing system",
        version: "1.0.0",
      },
      tags: [
        { name: "Health", description: "Health check endpoints" },
        {
          name: "Authentication",
          description: "Authentication related endpoints",
        },
        { name: "Auth Providers", description: "External authentication providers management" },
        { name: "User", description: "User management endpoints" },
        { name: "File", description: "File management endpoints" },
        { name: "Folder", description: "Folder management endpoints" },
        { name: "Share", description: "File sharing endpoints" },
        { name: "Storage", description: "Storage management endpoints" },
        { name: "App", description: "Application configuration endpoints" },
      ],
    },
    transform: jsonSchemaTransform,
  });
}
