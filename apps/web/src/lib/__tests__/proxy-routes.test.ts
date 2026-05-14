/**
 * Tests for proxy route resolution ordering.
 *
 * The route table uses a linear scan matcher where static segments must come
 * before dynamic `:param` segments at the same depth. This file verifies that:
 *   1. Static paths are not accidentally swallowed by dynamic routes.
 *   2. Dynamic parameters are correctly extracted.
 *   3. Representative API paths all resolve to the expected backend paths.
 *   4. Unknown paths return null (no spurious matches).
 */

import { describe, expect, it } from "vitest";
import { matchRoute } from "../proxy";
import { routes } from "../proxy-routes";

/** Split a URL path string into segments (strips leading slash). */
function seg(path: string): string[] {
  return path.replace(/^\//, "").split("/");
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("proxy route resolution", () => {
  // ───────────────────────────────────────────────────────────────────────────
  // 1. Static vs dynamic ordering — most important invariant
  // ───────────────────────────────────────────────────────────────────────────
  describe("static segments must match before dynamic :param segments", () => {
    it("GET shares/list matches static 'shares/list' route, not dynamic shares/:shareId", () => {
      const result = matchRoute(seg("shares/list"), "GET");
      expect(result).not.toBeNull();
      expect(result!.config.path).toBe("shares/list");
      expect(result!.config.backendPath).toBe("/shares/me");
      expect(result!.params).toEqual({});
    });

    it("POST shares/create matches static 'shares/create', not any dynamic route", () => {
      const result = matchRoute(seg("shares/create"), "POST");
      expect(result).not.toBeNull();
      expect(result!.config.path).toBe("shares/create");
      expect(result!.config.backendPath).toBe("/shares");
    });

    it("GET shares/details/:shareId matches before any generic dynamic 3-seg share route", () => {
      const result = matchRoute(seg("shares/details/abc123"), "GET");
      expect(result).not.toBeNull();
      expect(result!.config.path).toBe("shares/details/:shareId");
      expect(result!.params).toEqual({ shareId: "abc123" });
    });

    it("GET reverse-shares/list matches static route, not dynamic reverse-shares/:id", () => {
      const result = matchRoute(seg("reverse-shares/list"), "GET");
      expect(result).not.toBeNull();
      expect(result!.config.path).toBe("reverse-shares/list");
      expect(result!.config.backendPath).toBe("/reverse-shares");
    });

    it("GET auth/providers/all matches static route before dynamic :provider segment", () => {
      const result = matchRoute(seg("auth/providers/all"), "GET");
      expect(result).not.toBeNull();
      expect(result!.config.path).toBe("auth/providers/all");
      expect(result!.params).toEqual({});
    });

    it("GET files/presigned-url matches static 2-seg route, not dynamic files/:id", () => {
      const result = matchRoute(seg("files/presigned-url"), "GET");
      expect(result).not.toBeNull();
      expect(result!.config.path).toBe("files/presigned-url");
      expect(result!.params).toEqual({});
    });

    it("GET users/list matches static route, not dynamic users/:id", () => {
      const result = matchRoute(seg("users/list"), "GET");
      expect(result).not.toBeNull();
      expect(result!.config.path).toBe("users/list");
      expect(result!.config.backendPath).toBe("/users");
    });

    it("GET users/details/:id matches static prefix, not a purely dynamic path", () => {
      const result = matchRoute(seg("users/details/user-42"), "GET");
      expect(result).not.toBeNull();
      expect(result!.config.path).toBe("users/details/:id");
      expect(result!.params).toEqual({ id: "user-42" });
    });

    it("POST reverse-shares/:reverseShareId/alias matches AFTER all static 3-seg reverse-share routes", () => {
      // The static routes like reverse-shares/activate/:id, reverse-shares/details/:id, etc.
      // must appear before the fully dynamic reverse-shares/:reverseShareId/alias
      const dynamicResult = matchRoute(seg("reverse-shares/rs-99/alias"), "POST");
      expect(dynamicResult).not.toBeNull();
      expect(dynamicResult!.config.path).toBe("reverse-shares/:reverseShareId/alias");
      expect(dynamicResult!.params).toEqual({ reverseShareId: "rs-99" });

      // Confirm static 3-seg routes are NOT confused with the dynamic one
      const staticResult = matchRoute(seg("reverse-shares/activate/rs-55"), "PATCH");
      expect(staticResult).not.toBeNull();
      expect(staticResult!.config.path).toBe("reverse-shares/activate/:id");
      expect(staticResult!.params).toEqual({ id: "rs-55" });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Multi-segment dynamic paths
  // ───────────────────────────────────────────────────────────────────────────
  describe("multi-segment dynamic paths", () => {
    it("POST reverse-shares/alias/:alias/multipart/abort matches 5-seg alias route", () => {
      const result = matchRoute(seg("reverse-shares/alias/my-alias/multipart/abort"), "POST");
      expect(result).not.toBeNull();
      expect(result!.config.path).toBe("reverse-shares/alias/:alias/multipart/abort");
      expect(result!.params).toEqual({ alias: "my-alias" });
    });

    it("POST reverse-shares/alias/:alias/upload/access matches 5-seg alias route", () => {
      const result = matchRoute(seg("reverse-shares/alias/test-alias/upload/access"), "POST");
      expect(result).not.toBeNull();
      expect(result!.config.path).toBe("reverse-shares/alias/:alias/upload/access");
      expect(result!.params).toEqual({ alias: "test-alias" });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Representative API paths — at least 20 paths verified
  // ───────────────────────────────────────────────────────────────────────────
  describe("representative API paths resolve to correct backend paths", () => {
    it("GET app/health → /health", () => {
      const r = matchRoute(seg("app/health"), "GET");
      expect(r?.config.backendPath).toBe("/health");
    });

    it("GET app/configs/public → /app/configs/public (more specific than app/configs)", () => {
      const r = matchRoute(seg("app/configs/public"), "GET");
      expect(r?.config.backendPath).toBe("/app/configs/public");
    });

    it("GET app/configs → /app/configs", () => {
      const r = matchRoute(seg("app/configs"), "GET");
      expect(r?.config.backendPath).toBe("/app/configs");
    });

    it("POST auth/login → /auth/login (no auth flag, clientHeaders=true)", () => {
      const r = matchRoute(seg("auth/login"), "POST");
      expect(r?.config.backendPath).toBe("/auth/login");
      expect(r?.config.clientHeaders).toBe(true);
    });

    it("GET auth/me → /auth/me", () => {
      const r = matchRoute(seg("auth/me"), "GET");
      expect(r?.config.backendPath).toBe("/auth/me");
    });

    it("POST auth/2fa/verify → /auth/2fa/verify", () => {
      const r = matchRoute(seg("auth/2fa/verify"), "POST");
      expect(r?.config.backendPath).toBe("/auth/2fa/verify");
    });

    it("GET auth/2fa/status → /auth/2fa/status", () => {
      const r = matchRoute(seg("auth/2fa/status"), "GET");
      expect(r?.config.backendPath).toBe("/auth/2fa/status");
    });

    it("GET auth/providers/:provider/authorize → correct OAuth authorize route", () => {
      const r = matchRoute(seg("auth/providers/google/authorize"), "GET");
      expect(r?.config.path).toBe("auth/providers/:provider/authorize");
      expect(r?.config.redirect).toBe(true);
      expect(r?.params).toEqual({ provider: "google" });
    });

    it("PUT auth/providers/manage/:id matches static 'manage' segment before :provider routes", () => {
      const r = matchRoute(seg("auth/providers/manage/provider-1"), "PUT");
      expect(r?.config.path).toBe("auth/providers/manage/:id");
      expect(r?.params).toEqual({ id: "provider-1" });
    });

    it("PATCH config/update/bulk → /app/configs (bulk before dynamic :key)", () => {
      const r = matchRoute(seg("config/update/bulk"), "PATCH");
      expect(r?.config.path).toBe("config/update/bulk");
      expect(r?.config.backendPath).toBe("/app/configs");
    });

    it("PATCH config/update/:key → /app/configs/:key", () => {
      const r = matchRoute(seg("config/update/smtp_host"), "PATCH");
      expect(r?.config.path).toBe("config/update/:key");
      expect(r?.params).toEqual({ key: "smtp_host" });
    });

    it("POST files/multipart/create → /files/multipart/create", () => {
      const r = matchRoute(seg("files/multipart/create"), "POST");
      expect(r?.config.backendPath).toBe("/files/multipart/create");
    });

    it("POST files/download → /files/download (stream=true, auth=true)", () => {
      const r = matchRoute(seg("files/download"), "POST");
      expect(r?.config.backendPath).toBe("/files/download");
      expect(r?.config.stream).toBe(true);
      expect(r?.config.auth).toBe(true);
    });

    it("PATCH files/:id → /files/:id with param extracted", () => {
      const r = matchRoute(seg("files/file-xyz"), "PATCH");
      expect(r?.config.path).toBe("files/:id");
      expect(r?.params).toEqual({ id: "file-xyz" });
    });

    it("POST shares/:shareId/access extracts shareId correctly", () => {
      const r = matchRoute(seg("shares/share-abc/access"), "POST");
      expect(r?.config.path).toBe("shares/:shareId/access");
      expect(r?.params).toEqual({ shareId: "share-abc" });
    });

    it("POST shares/alias/create/:shareId → /shares/:shareId/alias", () => {
      const r = matchRoute(seg("shares/alias/create/s123"), "POST");
      expect(r?.config.backendPath).toBe("/shares/:shareId/alias");
      expect(r?.params).toEqual({ shareId: "s123" });
    });

    it("GET shares/alias/get/:alias → /shares/alias/:alias", () => {
      const r = matchRoute(seg("shares/alias/get/my-alias"), "GET");
      expect(r?.config.backendPath).toBe("/shares/alias/:alias");
      expect(r?.params).toEqual({ alias: "my-alias" });
    });

    it("POST shares/files/add/:shareId → /shares/:shareId/items with bodyTransform", () => {
      const r = matchRoute(seg("shares/files/add/s456"), "POST");
      expect(r?.config.backendPath).toBe("/shares/:shareId/items");
      expect(r?.config.bodyTransform).toBeDefined();
      expect(r?.params).toEqual({ shareId: "s456" });
    });

    it("GET folders/:id/contents → /folders/:id/contents", () => {
      const r = matchRoute(seg("folders/folder-99/contents"), "GET");
      expect(r?.config.backendPath).toBe("/folders/:id/contents");
      expect(r?.params).toEqual({ id: "folder-99" });
    });

    it("GET invite-tokens/:token → /invite-tokens/:token (no cookie)", () => {
      const r = matchRoute(seg("invite-tokens/tok123"), "GET");
      expect(r?.config.backendPath).toBe("/invite-tokens/:token");
      expect(r?.config.cookie).toBe(false);
      expect(r?.params).toEqual({ token: "tok123" });
    });

    it("POST register-with-invite → /register-with-invite (no cookie)", () => {
      const r = matchRoute(seg("register-with-invite"), "POST");
      expect(r?.config.backendPath).toBe("/register-with-invite");
      expect(r?.config.cookie).toBe(false);
    });

    it("POST users/register → /auth/register", () => {
      const r = matchRoute(seg("users/register"), "POST");
      expect(r?.config.backendPath).toBe("/auth/register");
    });

    it("DELETE users/delete/:id → /users/:id", () => {
      const r = matchRoute(seg("users/delete/u-7"), "DELETE");
      expect(r?.config.backendPath).toBe("/users/:id");
      expect(r?.params).toEqual({ id: "u-7" });
    });

    it("GET reverse-shares/upload/:id → /reverse-shares/:id/upload (no cookie)", () => {
      const r = matchRoute(seg("reverse-shares/upload/rs-1"), "GET");
      expect(r?.config.backendPath).toBe("/reverse-shares/:id/upload");
      expect(r?.config.cookie).toBe(false);
    });

    it("DELETE reverse-shares/files/delete/:fileId → /reverse-shares/files/:fileId", () => {
      const r = matchRoute(seg("reverse-shares/files/delete/f99"), "DELETE");
      expect(r?.config.path).toBe("reverse-shares/files/delete/:fileId");
      expect(r?.config.backendPath).toBe("/reverse-shares/files/:fileId");
      expect(r?.params).toEqual({ fileId: "f99" });
    });

    it("GET reverse-shares/files/download/:fileId → /reverse-shares/files/:fileId/download (stream)", () => {
      const r = matchRoute(seg("reverse-shares/files/download/f88"), "GET");
      expect(r?.config.path).toBe("reverse-shares/files/download/:fileId");
      expect(r?.config.backendPath).toBe("/reverse-shares/files/:fileId/download");
      expect(r?.config.stream).toBe(true);
    });

    it("POST reverse-shares/files/:fileId/copy → correct copy route with healthCheck", () => {
      const r = matchRoute(seg("reverse-shares/files/f77/copy"), "POST");
      expect(r?.config.path).toBe("reverse-shares/files/:fileId/copy");
      expect(r?.config.healthCheck).toBe(true);
      expect(r?.params).toEqual({ fileId: "f77" });
    });

    it("GET auth/trusted-devices → /auth/trusted-devices (auth + clientHeaders)", () => {
      const r = matchRoute(seg("auth/trusted-devices"), "GET");
      expect(r?.config.backendPath).toBe("/auth/trusted-devices");
      expect(r?.config.auth).toBe(true);
      expect(r?.config.clientHeaders).toBe(true);
    });

    it("DELETE auth/trusted-devices/:id → /auth/trusted-devices/:id with param", () => {
      const r = matchRoute(seg("auth/trusted-devices/dev-5"), "DELETE");
      expect(r?.config.path).toBe("auth/trusted-devices/:id");
      expect(r?.params).toEqual({ id: "dev-5" });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Non-matching paths return null
  // ───────────────────────────────────────────────────────────────────────────
  describe("unknown paths return null", () => {
    it("returns null for a completely unknown path", () => {
      expect(matchRoute(seg("unknown/path"), "GET")).toBeNull();
    });

    it("returns null for a known path with wrong method", () => {
      // shares/list only exists for GET
      expect(matchRoute(seg("shares/list"), "POST")).toBeNull();
    });

    it("returns null for a known 2-seg path hit with wrong segment count", () => {
      // auth/me is 2 segments; auth/me/extra is 3 — should not match
      expect(matchRoute(seg("auth/me/extra"), "GET")).toBeNull();
    });

    it("returns null for an empty path", () => {
      expect(matchRoute([], "GET")).toBeNull();
    });

    it("returns null for a plausible-looking but non-existent route", () => {
      expect(matchRoute(seg("shares/nonexistent"), "PATCH")).toBeNull();
    });

    it("returns null for GET config/list (deprecated returns 410, but matches — verify it matches)", () => {
      // config/list exists but is deprecated; it should still resolve (handler returns 410)
      const r = matchRoute(seg("config/list"), "GET");
      expect(r).not.toBeNull();
      expect(r!.config.deprecated).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Parameter extraction correctness
  // ───────────────────────────────────────────────────────────────────────────
  describe("parameter extraction", () => {
    it("extracts shareId from shares/abc123/access", () => {
      const r = matchRoute(seg("shares/abc123/access"), "POST");
      expect(r?.params).toEqual({ shareId: "abc123" });
    });

    it("extracts alias from reverse-shares/alias/:alias/upload path", () => {
      const r = matchRoute(seg("reverse-shares/alias/my-upload/upload"), "GET");
      expect(r?.params).toEqual({ alias: "my-upload" });
    });

    it("extracts id from files/:id move route", () => {
      const r = matchRoute(seg("files/file-id-1/move"), "PUT");
      expect(r?.config.path).toBe("files/:id/move");
      expect(r?.params).toEqual({ id: "file-id-1" });
    });

    it("extracts id from folders/:id/files route", () => {
      const r = matchRoute(seg("folders/folder-abc/files"), "GET");
      expect(r?.config.path).toBe("folders/:id/files");
      expect(r?.params).toEqual({ id: "folder-abc" });
    });

    it("extracts key from config/update/:key", () => {
      const r = matchRoute(seg("config/update/smtp_port"), "PATCH");
      expect(r?.params).toEqual({ key: "smtp_port" });
    });

    it("extracts token from invite-tokens/:token", () => {
      const r = matchRoute(seg("invite-tokens/inv-tok-xyz"), "GET");
      expect(r?.params).toEqual({ token: "inv-tok-xyz" });
    });

    it("extracts provider from auth/providers/:provider/callback", () => {
      const r = matchRoute(seg("auth/providers/github/callback"), "GET");
      expect(r?.config.path).toBe("auth/providers/:provider/callback");
      expect(r?.params).toEqual({ provider: "github" });
    });

    it("extracts reverseShareId from reverse-shares/:reverseShareId/alias", () => {
      const r = matchRoute(seg("reverse-shares/rs-dynamic-123/alias"), "POST");
      expect(r?.params).toEqual({ reverseShareId: "rs-dynamic-123" });
    });

    it("extracts id from reverse-shares/upload/:id/access (4-seg)", () => {
      const r = matchRoute(seg("reverse-shares/upload/rs-id-1/access"), "POST");
      expect(r?.config.path).toBe("reverse-shares/upload/:id/access");
      expect(r?.params).toEqual({ id: "rs-id-1" });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6. Route table ordering invariant (self-verification)
  // ───────────────────────────────────────────────────────────────────────────
  describe("route table ordering invariant", () => {
    it("every route in the table has a unique (method, path) combination", () => {
      const seen = new Set<string>();
      for (const config of routes) {
        const key = `${config.method}:${config.path}`;
        expect(seen.has(key), `Duplicate route: ${key}`).toBe(false);
        seen.add(key);
      }
    });

    it("no route pattern has empty segments (no double-slashes)", () => {
      for (const config of routes) {
        const parts = config.path.split("/");
        for (const part of parts) {
          expect(part.length, `Empty segment in path: ${config.path}`).toBeGreaterThan(0);
        }
      }
    });

    it("all :param names in backendPath are present in the frontend path", () => {
      const paramRegex = /:(\w+)/g;
      for (const config of routes) {
        const frontendParams = new Set([...config.path.matchAll(paramRegex)].map((m) => m[1]));
        const backendParams = [...config.backendPath.matchAll(paramRegex)].map((m) => m[1]);
        for (const param of backendParams) {
          expect(
            frontendParams.has(param),
            `Backend param :${param} in path "${config.path}" → "${config.backendPath}" has no matching frontend param`,
          ).toBe(true);
        }
      }
    });
  });
});
