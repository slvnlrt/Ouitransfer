import { NextRequest, NextResponse } from "next/server";

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:3333";

/**
 * POST /api/files/embed-token
 * Generate a signed embed token for a file in a share (authenticated).
 */
export async function POST(req: NextRequest) {
  const cookieHeader = req.headers.get("cookie");
  const body = await req.text();

  const url = `${API_BASE_URL}/files/embed-token`;

  const apiRes = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: cookieHeader || "",
    },
    body,
  });

  const data = await apiRes.json();

  return new NextResponse(JSON.stringify(data), {
    status: apiRes.status,
    headers: { "Content-Type": "application/json" },
  });
}
