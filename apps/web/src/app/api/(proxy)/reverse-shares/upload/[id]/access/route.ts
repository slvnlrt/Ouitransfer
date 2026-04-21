import { NextRequest, NextResponse } from "next/server";

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:3333";

/**
 * POST /api/reverse-shares/upload/:id/access
 * Access a password-protected reverse share for upload by providing the password in the request body.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.text();

  const url = `${API_BASE_URL}/reverse-shares/${id}/upload/access`;

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
