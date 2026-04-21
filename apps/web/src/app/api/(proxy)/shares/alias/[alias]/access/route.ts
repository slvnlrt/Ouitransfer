import { NextRequest, NextResponse } from "next/server";

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:3333";

/**
 * POST /api/shares/alias/:alias/access
 * Access a password-protected share by alias, providing the password in the request body.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ alias: string }> }) {
  const cookieHeader = req.headers.get("cookie");
  const { alias } = await params;
  const body = await req.text();

  const fetchUrl = `${API_BASE_URL}/shares/alias/${alias}/access`;

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
