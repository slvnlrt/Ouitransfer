/**
 * @vitest-environment node
 *
 * Locale key parity test.
 * Ensures all locale files contain the same key structure as en-US.json,
 * preventing future key-addition regressions. Walks the entire nested structure
 * recursively and checks for both missing AND extra (orphan) keys.
 * Also checks that no locale file contains a UTF-8 BOM.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const messagesDir = join(__dirname, "../../messages");

/** UTF-8 BOM as a string prefix */
const BOM = "\uFEFF";

function loadLocale(filename: string): Record<string, unknown> {
  let content = readFileSync(join(messagesDir, filename), "utf-8");
  // Strip BOM if present so parsing doesn't fail; BOM presence is caught separately
  if (content.startsWith(BOM)) {
    content = content.slice(1);
  }
  return JSON.parse(content) as Record<string, unknown>;
}

function getLocaleFiles(): string[] {
  return readdirSync(messagesDir)
    .filter((f) => f.endsWith(".json"))
    .sort();
}

/**
 * Recursively collect all dotted key paths from a nested object.
 * Example: { a: { b: "x", c: { d: "y" } } } → ["a.b", "a.c.d"]
 */
function collectKeyPaths(obj: Record<string, unknown>, prefix = ""): string[] {
  const paths: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      paths.push(...collectKeyPaths(value as Record<string, unknown>, fullPath));
    } else {
      paths.push(fullPath);
    }
  }
  return paths;
}

describe("locale key parity", () => {
  const localeFiles = getLocaleFiles();
  const enUSData = loadLocale("en-US.json");
  const enUSPaths = new Set(collectKeyPaths(enUSData));

  it("should find all 23 locale files", () => {
    expect(localeFiles.length).toBeGreaterThanOrEqual(23);
    expect(localeFiles).toContain("en-US.json");
  });

  it("no locale file should contain a UTF-8 BOM", () => {
    const filesWithBom: string[] = [];
    for (const file of localeFiles) {
      const raw = readFileSync(join(messagesDir, file), "utf-8");
      if (raw.startsWith(BOM)) {
        filesWithBom.push(file);
      }
    }
    if (filesWithBom.length > 0) {
      throw new Error(
        `The following locale files contain a UTF-8 BOM and must be saved without BOM:\n${filesWithBom.map((f) => `  ${f}`).join("\n")}`,
      );
    }
  });

  it("all locale files should have the same top-level namespace keys as en-US.json", () => {
    const enUSTopLevel = Object.keys(enUSData).sort();
    const issues: string[] = [];

    for (const file of localeFiles) {
      if (file === "en-US.json") continue;

      const data = loadLocale(file);
      const topLevel = new Set(Object.keys(data));
      const missing = enUSTopLevel.filter((k) => !topLevel.has(k));
      const extra = [...topLevel].filter((k) => !enUSPaths.has(k) && !Object.hasOwn(enUSData, k));

      if (missing.length > 0) {
        issues.push(`  ${file}: missing [${missing.join(", ")}]`);
      }
      if (extra.length > 0) {
        issues.push(`  ${file}: extra [${extra.join(", ")}]`);
      }
    }

    if (issues.length > 0) {
      throw new Error(`Top-level namespace key mismatches:\n${issues.join("\n")}`);
    }
  });

  it("all locale files should have the same nested key paths as en-US.json", () => {
    const issues: string[] = [];

    for (const file of localeFiles) {
      if (file === "en-US.json") continue;

      const data = loadLocale(file);
      const localePaths = new Set(collectKeyPaths(data));

      const missing = [...enUSPaths].filter((p) => !localePaths.has(p));
      const extra = [...localePaths].filter((p) => !enUSPaths.has(p));

      if (missing.length > 0) {
        issues.push(
          `  ${file}: missing ${missing.length} keys: ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? ` ... and ${missing.length - 10} more` : ""}`,
        );
      }
      if (extra.length > 0) {
        issues.push(
          `  ${file}: extra ${extra.length} keys: ${extra.slice(0, 10).join(", ")}${extra.length > 10 ? ` ... and ${extra.length - 10} more` : ""}`,
        );
      }
    }

    if (issues.length > 0) {
      throw new Error(`Nested key path mismatches vs en-US.json:\n${issues.join("\n")}`);
    }
  });
});
