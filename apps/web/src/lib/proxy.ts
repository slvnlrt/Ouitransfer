/**
 * Unified proxy handler — replaces 110 individual route files.
 *
 * Matches incoming requests against the route table in proxy-routes.ts,
 * builds the backend request, and returns the response.
 */

import { detectMimeTypeWithFallback } from "@ouitransfer/shared/mime-types";
import { type NextRequest, NextResponse } from "next/server";

import { logger } from "@/lib/logger";

import { type RouteConfig, routes } from "./proxy-routes";
import { getClientHeaders } from "./proxy-utils";

const API_BASE_URL = (process.env.API_BASE_URL || "http://localhost:3333").replace(/\/+$/, "");

/**
 * Well-known OAuth provider hostnames. Extended at runtime by
 * OAUTH_ALLOWED_REDIRECT_HOSTS env var for custom OIDC providers
 * (e.g. Keycloak, Auth0).
 */
const BUILTIN_OAUTH_HOSTS = new Set([
  "accounts.google.com",
  "github.com",
  "gitlab.com",
  "login.microsoftonline.com",
  "discord.com",
  "accounts.spotify.com",
]);

function getAllowedRedirectHosts(): Set<string> {
  const hosts = new Set(BUILTIN_OAUTH_HOSTS);
  const envHosts = process.env.OAUTH_ALLOWED_REDIRECT_HOSTS;
  if (envHosts) {
    for (const h of envHosts.split(",")) {
      const trimmed = h.trim().toLowerCase();
      if (trimmed) hosts.add(trimmed);
    }
  }
  return hosts;
}

/**
 * Validate that a redirect URL is safe:
 * - Relative URLs (starting with "/" but not "//") are always allowed
 * - Same-origin URLs are allowed
 * - Known OAuth provider hostnames (built-in + env OAUTH_ALLOWED_REDIRECT_HOSTS) are allowed
 * - Everything else is blocked
 */
export function isAllowedRedirectUrl(location: string, requestUrl: string): boolean {
  // Relative URLs are safe (same-origin implied by browser)
  if (location.startsWith("/") && !location.startsWith("//")) {
    return true;
  }

  try {
    const locationUrl = new URL(location);
    const reqUrl = new URL(requestUrl);

    // Same-origin check
    if (locationUrl.origin === reqUrl.origin) {
      return true;
    }

    // Known OAuth provider (built-in + env)
    const allowedHosts = getAllowedRedirectHosts();
    if (allowedHosts.has(locationUrl.hostname.toLowerCase())) {
      return true;
    }

    return false;
  } catch {
    // Malformed URL
    return false;
  }
}

interface MatchResult {
  config: RouteConfig;
  params: Record<string, string>;
}

/**
 * Match URL path segments and HTTP method against the route table.
 * Returns the first match with extracted :param values, or null.
 */
export function matchRoute(segments: string[], method: string): MatchResult | null {
  for (const config of routes) {
    if (config.method !== method) continue;

    const patternParts = config.path.split("/");
    if (patternParts.length !== segments.length) continue;

    const params: Record<string, string> = {};
    let matched = true;

    for (let i = 0; i < patternParts.length; i++) {
      const part = patternParts[i];
      if (part.startsWith(":")) {
        params[part.slice(1)] = segments[i];
      } else if (part !== segments[i]) {
        matched = false;
        break;
      }
    }

    if (matched) {
      return { config, params };
    }
  }

  return null;
}

/**
 * Substitute :param placeholders in the backend path with matched values.
 */
function buildBackendUrl(
  backendPath: string,
  params: Record<string, string>,
  queryString: string,
  forwardQuery: boolean,
): string {
  let url =
    API_BASE_URL +
    backendPath.replace(/:(\w+)/g, (_, key) => encodeURIComponent(params[key] ?? ""));
  if (forwardQuery && queryString) {
    url += queryString;
  }
  return url;
}

/**
 * Assemble request headers based on route configuration.
 */
function buildRequestHeaders(req: NextRequest, config: RouteConfig): Record<string, string> {
  const headers: Record<string, string> = {};

  // Content-Type
  if (!config.body) {
    headers["Content-Type"] = "application/json";
  } else {
    const ct = req.headers.get("content-type");
    if (ct) headers["Content-Type"] = ct;
  }

  // Cookie (default: true)
  if (config.cookie !== false) {
    const cookie = req.headers.get("cookie");
    if (cookie) headers.cookie = cookie;
  }

  // Authorization header
  if (config.auth) {
    const auth = req.headers.get("authorization");
    if (auth) headers.authorization = auth;
  }

  // CSRF token (double-submit pattern — browser sends the header,
  // the _csrf cookie is forwarded via the cookie block above)
  const csrfToken = req.headers.get("x-csrf-token");
  if (csrfToken) {
    headers["x-csrf-token"] = csrfToken;
  }

  // Client IP/UA headers
  if (config.clientHeaders) {
    Object.assign(headers, getClientHeaders(req));
  }

  // Forwarded host/proto (OAuth flows)
  if (config.forwardedHost) {
    const url = new URL(req.url);
    headers["x-forwarded-host"] = req.headers.get("host") || url.host;
    headers["x-forwarded-proto"] =
      req.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");
  }

  // Extra headers by prefix match
  if (config.extraHeaders) {
    for (const [key, value] of req.headers.entries()) {
      if (config.extraHeaders.some((prefix) => key.startsWith(prefix))) {
        headers[key] = value;
      }
    }
  }

  return headers;
}

/**
 * Forward Set-Cookie headers from the backend response.
 */
function forwardSetCookie(apiRes: Response, res: NextResponse): void {
  const cookies = apiRes.headers.getSetCookie?.() ?? [];
  for (const cookie of cookies) {
    res.headers.append("set-cookie", cookie);
  }
  // Fallback for environments where getSetCookie is not available
  if (cookies.length === 0) {
    const single = apiRes.headers.get("set-cookie");
    if (single) {
      res.headers.set("set-cookie", single);
    }
  }
}

/**
 * Build a standard JSON proxy response with Set-Cookie forwarding.
 */
async function buildJsonResponse(apiRes: Response): Promise<NextResponse> {
  const body = await apiRes.text();
  const res = new NextResponse(body, {
    status: apiRes.status,
    headers: { "Content-Type": "application/json" },
  });
  forwardSetCookie(apiRes, res);
  return res;
}

/**
 * Build a streaming response for file downloads.
 * Uses detectMimeTypeWithFallback for better Content-Type detection.
 */
async function buildStreamingResponse(apiRes: Response): Promise<NextResponse> {
  // On error, return JSON body
  if (!apiRes.ok) {
    const errorText = await apiRes.text();
    return new NextResponse(errorText, {
      status: apiRes.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  const serverContentType = apiRes.headers.get("content-type");
  const contentDisposition = apiRes.headers.get("content-disposition");
  const contentType = detectMimeTypeWithFallback(serverContentType, contentDisposition);

  const responseHeaders: Record<string, string> = { "Content-Type": contentType };

  // Forward binary-relevant headers
  for (const name of [
    "content-disposition",
    "content-length",
    "cache-control",
    "accept-ranges",
    "content-range",
  ]) {
    const value = apiRes.headers.get(name);
    if (value) responseHeaders[name] = value;
  }

  const res = new NextResponse(apiRes.body, {
    status: apiRes.status,
    headers: responseHeaders,
  });
  forwardSetCookie(apiRes, res);
  return res;
}

/** Hop-by-hop headers that must not be forwarded through a proxy (RFC 7230). */
const HOP_BY_HOP_HEADERS = new Set([
  "transfer-encoding",
  "connection",
  "keep-alive",
  "upgrade",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "content-encoding",
  "content-length",
]);

/**
 * Build a response that forwards ALL backend headers (e.g., auth/config),
 * except hop-by-hop headers. Uses `append` for `set-cookie` to avoid
 * clobbering multiple values.
 */
async function buildAllHeadersResponse(apiRes: Response): Promise<NextResponse> {
  const body = await apiRes.text();
  const res = new NextResponse(body, {
    status: apiRes.status,
    statusText: apiRes.statusText,
  });
  apiRes.headers.forEach((value, key) => {
    if (HOP_BY_HOP_HEADERS.has(key)) return;
    if (key === "set-cookie") {
      res.headers.append(key, value);
    } else {
      res.headers.set(key, value);
    }
  });
  return res;
}

/**
 * Main proxy handler — called by the catch-all route.
 */
export async function handleProxyRequest(
  req: NextRequest,
  segments: string[],
  method: string,
): Promise<NextResponse> {
  const result = matchRoute(segments, method);

  if (!result) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { config, params } = result;

  // Deprecated endpoint
  if (config.deprecated) {
    return NextResponse.json(
      { error: "This endpoint has been removed. Use server actions instead." },
      { status: 410 },
    );
  }

  try {
    // Optional health check (long operations like file copy)
    if (config.healthCheck) {
      const healthRes = await fetch(`${API_BASE_URL}/health`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });
      if (!healthRes.ok) {
        throw new Error(`Backend health check failed: ${healthRes.status}`);
      }
    }

    // Build backend URL
    const reqUrl = new URL(req.url);
    const backendUrl = buildBackendUrl(
      config.backendPath,
      params,
      reqUrl.search,
      config.query === true,
    );

    // Build headers
    const headers = buildRequestHeaders(req, config);

    // Build body — GET and DELETE (without bodyTransform) send no body
    let body: BodyInit | null = null;
    if (method !== "GET" && method !== "DELETE") {
      if (config.body === "raw" || config.body === "duplex") {
        body = req.body;
      } else if (config.bodyTransform) {
        const text = await req.text();
        body = config.bodyTransform(text || "{}");
      } else {
        body = (await req.text()) || "{}";
      }
    } else if (method === "DELETE" && config.bodyTransform) {
      // DELETE with body transform (e.g. shares items routes)
      const text = await req.text();
      body = config.bodyTransform(text || "{}");
    }

    // Don't send Content-Type for bodyless DELETE requests
    if (method === "DELETE" && !config.bodyTransform) {
      delete headers["Content-Type"];
    }

    // Fetch options
    const fetchOpts: RequestInit = {
      method,
      headers,
      redirect: "manual",
    };
    if (body !== null) {
      fetchOpts.body = body;
    }
    if (config.body === "raw" || config.body === "duplex") {
      // @ts-expect-error duplex not in TS types yet but required at runtime for streaming uploads
      fetchOpts.duplex = "half";
    }

    // Abort signal: always forward the client signal, combine with timeout if configured
    if (config.timeout) {
      fetchOpts.signal = AbortSignal.any([req.signal, AbortSignal.timeout(config.timeout)]);
    } else {
      fetchOpts.signal = req.signal;
    }

    // Execute request
    const apiRes = await fetch(backendUrl, fetchOpts);

    // Handle 3xx redirects (OAuth authorize/callback)
    if (config.redirect && apiRes.status >= 300 && apiRes.status < 400) {
      const location = apiRes.headers.get("location");
      if (location) {
        if (!isAllowedRedirectUrl(location, req.url)) {
          logger.error(`Proxy blocked suspicious redirect to: ${location}`);
          return NextResponse.json({ error: "Invalid redirect target" }, { status: 502 });
        }
        const absoluteUrl = new URL(location, req.url).toString();
        const response = new NextResponse(null, {
          status: apiRes.status,
          headers: { location: absoluteUrl },
        });
        forwardSetCookie(apiRes, response);
        return response;
      }
    }

    // Build response based on type
    if (config.stream) {
      return buildStreamingResponse(apiRes);
    }
    if (config.allResponseHeaders) {
      return buildAllHeadersResponse(apiRes);
    }
    return buildJsonResponse(apiRes);
  } catch (error: unknown) {
    const err = error as Error & { name?: string };
    logger.error(`Proxy error [${method} /${segments.join("/")}]`, {
      err: err.message ?? String(error),
    });

    if (err.name === "AbortError") {
      return NextResponse.json(
        { error: "Request timed out", details: "The operation took too long to complete" },
        { status: 408 },
      );
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
