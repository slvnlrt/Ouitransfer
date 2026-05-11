import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Math.random() elimination (5.9)", () => {
  const files = [
    "src/modules/file/controller.ts",
    "src/modules/file/multipart.controller.ts",
    "src/config/directories.config.ts",
  ];

  for (const file of files) {
    it(`${file} should not use Math.random()`, () => {
      const content = readFileSync(new URL(`../../${file}`, import.meta.url), "utf-8");
      expect(content).not.toContain("Math.random()");
    });
  }
});
