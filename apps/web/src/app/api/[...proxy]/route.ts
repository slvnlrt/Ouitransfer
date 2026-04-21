/**
 * Catch-all API proxy route.
 *
 * All /api/* requests are matched against the route table in proxy-routes.ts
 * and forwarded to the Fastify backend. This replaces 110 individual route files.
 */

import type { NextRequest } from "next/server";

import { handleProxyRequest } from "@/lib/proxy";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ proxy: string[] }> };

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { proxy } = await ctx.params;
  return handleProxyRequest(req, proxy, "GET");
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { proxy } = await ctx.params;
  return handleProxyRequest(req, proxy, "POST");
}

export async function PUT(req: NextRequest, ctx: RouteContext) {
  const { proxy } = await ctx.params;
  return handleProxyRequest(req, proxy, "PUT");
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const { proxy } = await ctx.params;
  return handleProxyRequest(req, proxy, "DELETE");
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const { proxy } = await ctx.params;
  return handleProxyRequest(req, proxy, "PATCH");
}
