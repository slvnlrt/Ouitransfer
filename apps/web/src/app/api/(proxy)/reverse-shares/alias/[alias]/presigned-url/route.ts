import { NextRequest, NextResponse } from "next/server";

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:3333";

/**
 * POST /api/reverse-shares/alias/:alias/presigned-url
 * Password is now sent in the request body (not as a query parameter).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ alias: string }> }) {
  const body = await req.text();
  const { alias } = await params;

  const url = `${API_BASE_URL}/reverse-shares/alias/${alias}/presigned-url`;

  const apiRes = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body,
    redirect: "manual",
  });

  const resBody = await apiRes.text();

  return new NextResponse(resBody, {
    status: apiRes.status,
    headers: { "Content-Type": "application/json" },
  });
}
