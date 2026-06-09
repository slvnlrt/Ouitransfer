/**
 * file-size-input.test.ts
 *
 * Unit tests for the BigInt-based byte ↔ human conversion helpers in
 * FileSizeInput. The widget feeds BigInt-exact byte fields (maxFileSize,
 * maxTotalStoragePerUser, reverseShareAbsoluteMaxBytes), so whole-number sizes
 * must round-trip exactly at ANY magnitude — including values above
 * Number.MAX_SAFE_INTEGER (2^53), where the previous Number-based math lost
 * precision. Existing small-value behavior is preserved.
 */

import { describe, expect, it } from "vitest";
import { bytesToHumanReadable, humanReadableToBytes } from "../file-size-input";

// Use the BigInt() constructor (not `n` literals) — the web tsconfig targets
// ES2017, which predates BigInt-literal syntax.
const KIB = BigInt(1024);
const MB = KIB * KIB;
const GB = MB * KIB;
const TB = GB * KIB;
const PB = TB * KIB;
const TWO = BigInt(2);
const FOUR = BigInt(4);
const NINE = BigInt(9);
const TEN = BigInt(10);
const SEVENTY_FIVE = BigInt(75);
const HUNDRED = BigInt(100);
const FIVE = BigInt(5);
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER); // 9007199254740992

describe("humanReadableToBytes", () => {
  it("converts small whole-number values exactly", () => {
    expect(humanReadableToBytes("75", "GB")).toBe((SEVENTY_FIVE * GB).toString());
    expect(humanReadableToBytes("100", "MB")).toBe((HUNDRED * MB).toString());
    expect(humanReadableToBytes("1", "TB")).toBe(TB.toString());
  });

  it("converts fractional values via scaled-integer math (no Number rounding)", () => {
    // 1.5 GB = 1.5 * 1073741824 = 1610612736.
    expect(humanReadableToBytes("1.5", "GB")).toBe((GB + GB / TWO).toString());
    // 2.25 MB = 2.25 * 1048576 = 2359296.
    expect(humanReadableToBytes("2.25", "MB")).toBe(((NINE * MB) / FOUR).toString());
  });

  it("is EXACT for values above Number.MAX_SAFE_INTEGER (>9PB)", () => {
    // 10 PB = 11258999068426240 bytes > 2^53 (9007199254740992).
    const tenPB = TEN * PB;
    expect(tenPB > MAX_SAFE).toBe(true);
    expect(humanReadableToBytes("10", "PB")).toBe(tenPB.toString());
    // The old Number-based path (10 * 1.125e16) would have lost the low digits.
    expect(humanReadableToBytes("10", "PB")).toBe("11258999068426240");
  });

  it("returns '0' for empty, zero, or malformed input", () => {
    expect(humanReadableToBytes("", "GB")).toBe("0");
    expect(humanReadableToBytes("0", "GB")).toBe("0");
    expect(humanReadableToBytes(".", "GB")).toBe("0");
  });
});

describe("bytesToHumanReadable", () => {
  it("picks the largest unit that divides exactly, as a whole number", () => {
    expect(bytesToHumanReadable((SEVENTY_FIVE * GB).toString())).toEqual({
      value: "75",
      unit: "GB",
    });
    expect(bytesToHumanReadable((FIVE * PB).toString())).toEqual({ value: "5", unit: "PB" });
    expect(bytesToHumanReadable((HUNDRED * MB).toString())).toEqual({ value: "100", unit: "MB" });
  });

  it("renders fractional sizes with two decimals when no unit divides exactly", () => {
    // 1.5 MB = 1572864 bytes: not an exact multiple of MB (the largest unit ≥ 1),
    // so it renders fractionally → "1.50 MB". (A value like 1.5 GB instead picks
    // its exact whole-number representation, 1536 MB.)
    expect(bytesToHumanReadable((MB + MB / TWO).toString())).toEqual({ value: "1.50", unit: "MB" });
  });

  it("maps 0 / empty to the default 0 MB", () => {
    expect(bytesToHumanReadable("0")).toEqual({ value: "0", unit: "MB" });
    expect(bytesToHumanReadable("")).toEqual({ value: "0", unit: "MB" });
  });

  it("round-trips a large whole-number size EXACTLY (>9PB)", () => {
    const tenPB = (TEN * PB).toString();
    const { value, unit } = bytesToHumanReadable(tenPB);
    expect({ value, unit }).toEqual({ value: "10", unit: "PB" });
    expect(humanReadableToBytes(value, unit)).toBe(tenPB);
  });

  it("round-trips the realistic 75 GB cap exactly", () => {
    const seventyFiveGB = (SEVENTY_FIVE * GB).toString();
    const { value, unit } = bytesToHumanReadable(seventyFiveGB);
    expect(humanReadableToBytes(value, unit)).toBe(seventyFiveGB);
  });
});
