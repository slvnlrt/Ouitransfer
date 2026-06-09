import { useEffect, useState } from "react";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface FileSizeInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  error?: { message?: string };
  placeholder?: string;
}

export type Unit = "MB" | "GB" | "TB" | "PB";

// Byte multipliers as BigInt so conversions stay exact for whole-number sizes
// well above Number.MAX_SAFE_INTEGER (~9PB). The byte `value` flowing in/out of
// this widget feeds BigInt-exact fields (maxFileSize, maxTotalStoragePerUser,
// reverseShareAbsoluteMaxBytes), so the round-trip must not lose precision.
// (The `BigInt(...)` constructor is used instead of `n` literals because the
// web tsconfig targets ES2017, which predates BigInt-literal syntax.)
const ZERO = BigInt(0);
const KIB = BigInt(1024);
const UNIT_MULTIPLIERS: Record<Unit, bigint> = {
  MB: KIB * KIB,
  GB: KIB * KIB * KIB,
  TB: KIB * KIB * KIB * KIB,
  PB: KIB * KIB * KIB * KIB * KIB,
};

const UNITS_DESC: Unit[] = ["PB", "TB", "GB", "MB"];

/** Parse a decimal byte string into a non-negative BigInt; 0 on any garbage. */
function parseBytes(bytes: string): bigint {
  if (!/^\d+$/.test(bytes.trim())) return ZERO;
  try {
    const n = BigInt(bytes.trim());
    return n > ZERO ? n : ZERO;
  } catch {
    return ZERO;
  }
}

/**
 * Pick a human-readable {value, unit} for a byte count.
 *
 * When the byte count is an exact multiple of a unit, the value is rendered as a
 * whole number using BigInt division — exact at any magnitude. Otherwise it
 * falls back to a two-decimal Number rendering of the largest unit ≥ 1 (purely
 * for display; the exact byte value is preserved in the form state and is only
 * recomputed from the display on an explicit edit).
 */
export function bytesToHumanReadable(bytes: string): { value: string; unit: Unit } {
  const numBytes = parseBytes(bytes);
  if (numBytes <= ZERO) {
    return { value: "0", unit: "MB" };
  }

  // Prefer the largest unit that divides the byte count exactly → clean integer.
  for (const unit of UNITS_DESC) {
    const multiplier = UNIT_MULTIPLIERS[unit];
    if (numBytes >= multiplier && numBytes % multiplier === ZERO) {
      return { value: (numBytes / multiplier).toString(), unit };
    }
  }

  // No exact division: render the largest unit with magnitude ≥ 1, two decimals.
  // (Fractional human values are inherently approximate; realistic fractional
  // inputs are small, so Number precision is not a concern here.)
  for (const unit of UNITS_DESC) {
    const multiplier = UNIT_MULTIPLIERS[unit];
    if (numBytes >= multiplier) {
      const value = Number(numBytes) / Number(multiplier);
      const rounded = Math.round(value * 100) / 100;
      return { value: rounded.toFixed(2), unit };
    }
  }

  const mbValue = Number(numBytes) / Number(UNIT_MULTIPLIERS.MB);
  return { value: mbValue.toFixed(2), unit: "MB" };
}

/**
 * Convert a human value + unit back to an exact byte string.
 *
 * A whole-number value uses BigInt multiplication (exact at any magnitude). A
 * fractional value uses scaled-integer math: it splits on the decimal point and
 * combines `intPart * multiplier + fracPart * multiplier / 10^fracDigits`, all
 * in BigInt, so even fractional inputs convert without Number rounding.
 */
export function humanReadableToBytes(value: string, unit: Unit): string {
  const trimmed = value.trim();
  if (trimmed === "" || !/^\d*\.?\d*$/.test(trimmed) || trimmed === ".") {
    return "0";
  }

  const multiplier = UNIT_MULTIPLIERS[unit];
  const [intPartRaw, fracPartRaw = ""] = trimmed.split(".");
  const intPart = intPartRaw === "" ? ZERO : BigInt(intPartRaw);

  let bytes = intPart * multiplier;
  if (fracPartRaw !== "") {
    const fracValue = BigInt(fracPartRaw);
    const scale = BigInt(10) ** BigInt(fracPartRaw.length);
    // floor(fracValue / 10^fracDigits * multiplier) via integer arithmetic.
    bytes += (fracValue * multiplier) / scale;
  }

  return bytes > ZERO ? bytes.toString() : "0";
}

export function FileSizeInput({
  value,
  onChange,
  disabled = false,
  error,
  placeholder = "0",
}: FileSizeInputProps) {
  const [displayValue, setDisplayValue] = useState("");
  const [selectedUnit, setSelectedUnit] = useState<Unit>("MB");

  useEffect(() => {
    if (value && value !== "0") {
      const { value: humanValue, unit } = bytesToHumanReadable(value);
      setDisplayValue(humanValue);
      setSelectedUnit(unit);
    } else {
      setDisplayValue("");
      setSelectedUnit("MB");
    }
  }, [value]);

  const handleValueChange = (newValue: string) => {
    const sanitizedValue = newValue.replace(/[^0-9.]/g, "");

    const parts = sanitizedValue.split(".");
    const finalValue = parts.length > 2 ? `${parts[0]}.${parts.slice(1).join("")}` : sanitizedValue;

    setDisplayValue(finalValue);

    if (finalValue === "" || finalValue === "0") {
      onChange("0");
    } else {
      const bytesValue = humanReadableToBytes(finalValue, selectedUnit);
      onChange(bytesValue);
    }
  };

  const handleUnitChange = (newUnit: Unit) => {
    if (!newUnit || !["MB", "GB", "TB", "PB"].includes(newUnit)) {
      return;
    }

    setSelectedUnit(newUnit);

    if (displayValue && displayValue !== "0") {
      const bytesValue = humanReadableToBytes(displayValue, newUnit);
      onChange(bytesValue);
    }
  };

  return (
    <div className="flex gap-2">
      <Input
        type="text"
        value={displayValue}
        onChange={(e) => handleValueChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1"
        disabled={disabled}
        aria-invalid={!!error}
      />
      <Select
        key={`${selectedUnit}-${displayValue}`}
        value={selectedUnit}
        onValueChange={handleUnitChange}
        disabled={disabled}
      >
        <SelectTrigger className="w-20">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="MB">MB</SelectItem>
          <SelectItem value="GB">GB</SelectItem>
          <SelectItem value="TB">TB</SelectItem>
          <SelectItem value="PB">PB</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
