import { NextRequest, NextResponse } from "next/server";

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:3333";

/**
 * GET /api/reverse-shares/upload/:id
 * Get reverse share info for upload (non-password-protected shares only).
 * Password-protected shares should use POST /api/reverse-shares/upload/:id/access instead.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const url = `${API_BASE_URL}/reverse-shares/${id}/upload`;

  const apiRes = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
    redirect: "manual",
  });

  const resBody = await apiRes.text();

  return new NextResponse(resBody, {
    status: apiRes.status,
    headers: { "Content-Type": "application/json" },
  });
}
