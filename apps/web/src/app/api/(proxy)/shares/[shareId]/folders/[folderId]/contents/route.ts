import { NextRequest, NextResponse } from "next/server";

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:3333";

/**
 * GET /api/shares/:shareId/folders/:folderId/contents
 * For non-password-protected shares.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ shareId: string; folderId: string }> }) {
  const cookieHeader = req.headers.get("cookie");
  const { shareId, folderId } = await params;
  const fetchUrl = `${API_BASE_URL}/shares/${shareId}/folders/${folderId}/contents`;

  const apiRes = await fetch(fetchUrl, {
    method: "GET",
    headers: {
      cookie: cookieHeader || "",
    },
    redirect: "manual",
  });

  const resBody = await apiRes.text();

  const res = new NextResponse(resBody, {
    status: apiRes.status,
    headers: { "Content-Type": "application/json" },
  });

  const setCookie = apiRes.headers.getSetCookie?.() || [];
  if (setCookie.length > 0) {
    res.headers.set("Set-Cookie", setCookie.join(","));
  }

  return res;
}

/**
 * POST /api/shares/:shareId/folders/:folderId/contents
 * For password-protected shares — password is in the request body.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ shareId: string; folderId: string }> }) {
  const cookieHeader = req.headers.get("cookie");
  const { shareId, folderId } = await params;
  const body = await req.text();
  const fetchUrl = `${API_BASE_URL}/shares/${shareId}/folders/${folderId}/contents`;

  const apiRes = await fetch(fetchUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: cookieHeader || "",
    },
    body,
    redirect: "manual",
  });

  const resBody = await apiRes.text();

  const res = new NextResponse(resBody, {
    status: apiRes.status,
    headers: { "Content-Type": "application/json" },
  });

  const setCookie = apiRes.headers.getSetCookie?.() || [];
  if (setCookie.length > 0) {
    res.headers.set("Set-Cookie", setCookie.join(","));
  }

  return res;
}
