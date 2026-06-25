import { readdirSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EMAIL_LOCALES } from "../locales.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// __tests__ sits beside loader.ts, so messages/ is one directory up.
const messagesDir = path.join(__dirname, "..", "messages");

describe("EMAIL_LOCALES", () => {
  it("exactly matches the set of *.json files in messages/", () => {
    const fileLocales = readdirSync(messagesDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => path.basename(f, ".json"))
      .sort();

    expect(fileLocales).toEqual([...EMAIL_LOCALES].sort());
  });
});
