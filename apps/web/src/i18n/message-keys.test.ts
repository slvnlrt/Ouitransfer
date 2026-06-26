import { describe, expect, it } from "vitest";

import { pickMessages, routeMessages } from "./message-keys";

describe("pickMessages", () => {
  const messages: Record<string, unknown> = {
    a11y: { skipToContent: "Skip" },
    common: { loading: "Loading…" },
    login: { welcome: "Welcome" },
    errors: { network: "Network error" },
  };

  it("picks only specified keys", () => {
    const result = pickMessages(messages, ["a11y", "common"]);
    expect(result).toEqual({
      a11y: { skipToContent: "Skip" },
      common: { loading: "Loading…" },
    });
  });

  it("ignores missing keys", () => {
    const result = pickMessages(messages, ["a11y", "nonExistent"]);
    expect(result).toEqual({
      a11y: { skipToContent: "Skip" },
    });
  });

  it("returns empty object for empty namespaces array", () => {
    const result = pickMessages(messages, []);
    expect(result).toEqual({});
  });

  it("preserves nested structure without cloning", () => {
    const result = pickMessages(messages, ["login"]);
    expect(result).toEqual({ login: { welcome: "Welcome" } });
    // Same reference — not deep-cloned
    expect(result.login).toBe(messages.login);
  });
});

describe("routeMessages", () => {
  const messages: Record<string, unknown> = {
    a11y: { skipToContent: "Skip" },
    common: { loading: "Loading…" },
    login: { welcome: "Welcome" },
    errors: { network: "Network error" },
    footer: { text: "Footer" },
  };

  it("merges multiple groups", () => {
    const result = routeMessages(messages, ["a11y", "common"], ["login", "errors"]);
    expect(result).toEqual({
      a11y: { skipToContent: "Skip" },
      common: { loading: "Loading…" },
      login: { welcome: "Welcome" },
      errors: { network: "Network error" },
    });
  });

  it("deduplicates overlapping namespaces", () => {
    const result = routeMessages(messages, ["a11y", "common"], ["common", "login"]);
    expect(Object.keys(result).sort()).toEqual(["a11y", "common", "login"]);
    expect(result).toEqual({
      a11y: { skipToContent: "Skip" },
      common: { loading: "Loading…" },
      login: { welcome: "Welcome" },
    });
  });

  it("returns empty object when all groups are empty", () => {
    const result = routeMessages(messages, [], []);
    expect(result).toEqual({});
  });

  it("works with a single group", () => {
    const result = routeMessages(messages, ["footer"]);
    expect(result).toEqual({ footer: { text: "Footer" } });
  });
});
