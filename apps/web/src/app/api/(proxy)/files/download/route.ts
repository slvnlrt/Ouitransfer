import { NextRequest, NextResponse } from "next/server";

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:3333";

/**
 * POST /api/files/download
 * Downloads a file directly (returns file content).
 * Changed from GET to POST — password is now in the request body.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.text();

    const url = `${API_BASE_URL}/files/download`;

    const apiRes = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: req.headers.get("cookie") || "",
        ...Object.fromEntries(
          Array.from(req.headers.entries()).filter(
            ([key]) =>
              key.startsWith("authorization") ||
              key.startsWith("x-forwarded") ||
              key === "user-agent" ||
              key === "accept"
          )
        ),
      },
      body,
      redirect: "manual",
    });

    if (!apiRes.ok) {
      const errorText = await apiRes.text();
      return new NextResponse(errorText, {
        status: apiRes.status,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }

    // Stream the file content
    const contentType = apiRes.headers.get("content-type") || "application/octet-stream";
    const contentDisposition = apiRes.headers.get("content-disposition");
    const contentLength = apiRes.headers.get("content-length");
    const cacheControl = apiRes.headers.get("cache-control");

    const res = new NextResponse(apiRes.body, {
      status: apiRes.status,
      headers: {
        "Content-Type": contentType,
      },
    });

    if (contentDisposition) {
      res.headers.set("Content-Disposition", contentDisposition);
    }
    if (contentLength) {
      res.headers.set("Content-Length", contentLength);
    }
    if (cacheControl) {
      res.headers.set("Cache-Control", cacheControl);
    }

    return res;
  } catch (error) {
    console.error("Error proxying download request:", error);
    return new NextResponse(JSON.stringify({ error: "Failed to download file" }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }
}
