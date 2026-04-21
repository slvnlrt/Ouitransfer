import { describe, expect, it } from "vitest";

describe("Web app smoke test", () => {
  it("should have React available", async () => {
    const React = await import("react");
    expect(React).toBeDefined();
    expect(React.version).toBeTruthy();
  });

  it("should have the expected React version (19.x)", async () => {
    const React = await import("react");
    expect(React.version).toMatch(/^19\./);
  });
});
