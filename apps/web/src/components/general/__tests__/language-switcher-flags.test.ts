/**
 * @vitest-environment node
 *
 * Flag-asset parity test.
 *
 * The language switcher renders self-hosted flag SVGs from `public/flags/4x3/`
 * (via react-country-flag's `cdnUrl`), resolving each file by the locale's
 * region subtag (e.g. "fr-FR" → "fr.svg"). Adding a language without its SVG
 * yields a broken image with no other failure, so this test guards that every
 * supported locale has a matching flag file on disk.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { SUPPORTED_UI_LOCALES } from "@ouitransfer/shared/locales";
import { describe, expect, it } from "vitest";

import { languages } from "../language-switcher";

const flagsDir = join(__dirname, "../../../../public/flags/4x3");

/** Mirror the component: the region subtag (lowercased) is the SVG basename. */
function flagFileFor(locale: string): string {
  const region = locale.split("-")[1]?.toLowerCase();
  return `${region}.svg`;
}

describe("language switcher flag assets", () => {
  it("ships a self-hosted SVG for every supported locale", () => {
    const missing = Object.keys(languages).filter(
      (locale) => !existsSync(join(flagsDir, flagFileFor(locale))),
    );

    expect(missing).toEqual([]);
  });

  it("derives a region subtag for every locale (no malformed tags)", () => {
    const malformed = Object.keys(languages).filter((locale) => !locale.split("-")[1]);

    expect(malformed).toEqual([]);
  });

  // The switcher's `languages` map (display names) and the canonical
  // SUPPORTED_UI_LOCALES list (shared with the server) must not drift: a locale
  // offered in the UI but absent from the shared list would be rejected by the
  // server's PATCH /users/me/locale validation, and vice versa.
  it("offers exactly the canonical set of supported UI locales", () => {
    expect(Object.keys(languages).sort()).toEqual([...SUPPORTED_UI_LOCALES].sort());
  });
});
