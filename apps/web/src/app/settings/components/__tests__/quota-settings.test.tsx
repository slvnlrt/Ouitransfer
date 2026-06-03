/**
 * Tests for the 5.2 Phase B quota-overage policy fields, which live in the
 * existing "storage" settings group.
 *
 * Covers:
 *   - The exported settings schema validates the quota integer bounds, the
 *     `quotaWarningThresholds` CSV format, and the non-negative `reverseShare
 *     AbsoluteMaxBytes` byte count — mirroring the server-side validators in
 *     config-validation.ts.
 *   - The SettingsGroup component renders the storage group: Switch widgets for
 *     the two boolean toggles, number inputs for the integer fields, a text
 *     input for the thresholds CSV, and the friendly bytes widget (FileSizeInput)
 *     for the absolute cap.
 *   - Invalid input (bad thresholds CSV, factor < 1, negative bytes) produces the
 *     localized inline validation error on submit; valid input submits cleanly.
 */

import { zodResolver } from "@hookform/resolvers/zod";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Radix UI's Switch observes element size; jsdom lacks ResizeObserver.
beforeAll(() => {
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

// ── Mock next-intl ──────────────────────────────────────────────────────────
// `t(key, values)` returns the key with any ICU-style values appended so tests
// can assert that the localized error carries the correct `min` bound.
vi.mock("next-intl", () => ({
  useTranslations: () => {
    const t = (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key;
    return t;
  },
}));

// ── Imports after mocks ─────────────────────────────────────────────────────
import {
  createSettingsSchema,
  isValidNonNegativeBigint,
  isValidQuotaThresholds,
  QUOTA_INT_BOUNDS,
} from "../../hooks/use-settings";
import type { Config, GroupFormData } from "../../types";
import { SettingsGroup } from "../settings-group";

// A non-interpolating translator for building the schema in unit tests.
const t = ((key: string, values?: Record<string, unknown>) =>
  values ? `${key}:${JSON.stringify(values)}` : key) as never;

const STORAGE_CONFIGS: Config[] = [
  { key: "maxFileSize", value: "0", group: "storage", type: "bigint" },
  { key: "maxTotalStoragePerUser", value: "0", group: "storage", type: "bigint" },
  { key: "quotaWarningThresholds", value: "80,90", group: "storage", type: "text" },
  { key: "quotaGracePeriodDays", value: "7", group: "storage", type: "number" },
  { key: "quotaSmartDeletionEnabled", value: "false", group: "storage", type: "boolean" },
  { key: "quotaInactiveShareDays", value: "30", group: "storage", type: "number" },
  {
    key: "reverseShareQuotaSoftEnforcement",
    value: "true",
    group: "storage",
    type: "boolean",
  },
  { key: "reverseShareMaxOverageFactor", value: "3", group: "storage", type: "number" },
  { key: "reverseShareAbsoluteMaxBytes", value: "0", group: "storage", type: "bigint" },
];

function StorageGroupHarness({ onSubmit }: { onSubmit: (data: GroupFormData) => Promise<void> }) {
  const form = useForm<GroupFormData>({
    resolver: zodResolver(createSettingsSchema(t)),
    defaultValues: {
      configs: Object.fromEntries(STORAGE_CONFIGS.map((c) => [c.key, c.value])),
    },
  });

  return (
    <SettingsGroup
      group="storage"
      configs={STORAGE_CONFIGS}
      form={form}
      isCollapsed={false}
      onToggleCollapse={() => {}}
      onSubmit={onSubmit}
    />
  );
}

describe("quota overage settings schema", () => {
  it("declares bounds for every integer quota key (and no boolean/CSV/bytes keys)", () => {
    expect(QUOTA_INT_BOUNDS).toEqual({
      quotaGracePeriodDays: 0,
      quotaInactiveShareDays: 1,
      reverseShareMaxOverageFactor: 1,
    });
  });

  it("isValidQuotaThresholds mirrors the server CSV validator", () => {
    expect(isValidQuotaThresholds("80,90")).toBe(true);
    expect(isValidQuotaThresholds("1")).toBe(true);
    expect(isValidQuotaThresholds("99")).toBe(true);
    expect(isValidQuotaThresholds(" 80 , 90 ")).toBe(true); // whitespace tolerated
    expect(isValidQuotaThresholds("")).toBe(false);
    expect(isValidQuotaThresholds("   ")).toBe(false);
    expect(isValidQuotaThresholds("0,90")).toBe(false); // 0 out of range
    expect(isValidQuotaThresholds("80,100")).toBe(false); // 100 out of range
    expect(isValidQuotaThresholds("80,")).toBe(false); // empty entry
    expect(isValidQuotaThresholds("80,abc")).toBe(false); // non-numeric
    expect(isValidQuotaThresholds("80.5")).toBe(false); // non-integer
  });

  it("isValidNonNegativeBigint mirrors the server bigintMin(...,0n) validator", () => {
    expect(isValidNonNegativeBigint("0")).toBe(true);
    expect(isValidNonNegativeBigint("80530636800")).toBe(true); // 75 GB
    expect(isValidNonNegativeBigint("99999999999999999999")).toBe(true); // > 2^53, exact
    expect(isValidNonNegativeBigint("")).toBe(false);
    expect(isValidNonNegativeBigint("-1")).toBe(false);
    expect(isValidNonNegativeBigint("1.5")).toBe(false);
    expect(isValidNonNegativeBigint("abc")).toBe(false);
  });

  it("rejects an out-of-bounds integer (factor < 1) via the schema superRefine", () => {
    const schema = createSettingsSchema(t);
    const result = schema.safeParse({
      configs: { reverseShareMaxOverageFactor: "0" },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path.join(".") === "configs.reverseShareMaxOverageFactor",
      );
      expect(issue?.message).toContain("settings.errors.cleanupValueInvalid");
      expect(issue?.message).toContain('"min":1');
    }
  });

  it("rejects an invalid thresholds CSV via the schema superRefine", () => {
    const schema = createSettingsSchema(t);
    const result = schema.safeParse({
      configs: { quotaWarningThresholds: "80,150" },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path.join(".") === "configs.quotaWarningThresholds",
      );
      expect(issue?.message).toContain("settings.errors.quotaThresholdsInvalid");
    }
  });

  it("rejects a negative absolute byte cap via the schema superRefine", () => {
    const schema = createSettingsSchema(t);
    const result = schema.safeParse({
      configs: { reverseShareAbsoluteMaxBytes: "-1" },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path.join(".") === "configs.reverseShareAbsoluteMaxBytes",
      );
      expect(issue?.message).toContain("settings.errors.cleanupValueInvalid");
      expect(issue?.message).toContain('"min":0');
    }
  });

  it("accepts in-bounds values via the schema", () => {
    const schema = createSettingsSchema(t);
    const result = schema.safeParse({
      configs: {
        quotaWarningThresholds: "80,90",
        quotaGracePeriodDays: "7",
        quotaInactiveShareDays: "30",
        reverseShareMaxOverageFactor: "3",
        reverseShareAbsoluteMaxBytes: "0",
      },
    });
    expect(result.success).toBe(true);
  });
});

describe("quota overage settings group rendering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders Switches for the boolean toggles and number inputs for the integer fields", () => {
    render(<StorageGroupHarness onSubmit={vi.fn()} />);

    // Two boolean toggles → two switches.
    expect(screen.getAllByRole("switch")).toHaveLength(2);

    // Integer quota fields render as number inputs.
    for (const key of Object.keys(QUOTA_INT_BOUNDS)) {
      const input = document.getElementById(key) as HTMLInputElement | null;
      expect(input).not.toBeNull();
      expect(input?.type).toBe("number");
    }

    // The thresholds CSV renders as a plain text input.
    const thresholds = document.getElementById("quotaWarningThresholds") as HTMLInputElement | null;
    expect(thresholds).not.toBeNull();
    expect(thresholds?.type).toBe("text");
  });

  it("shows the localized inline error on submit when the thresholds CSV is invalid", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<StorageGroupHarness onSubmit={onSubmit} />);

    const input = document.getElementById("quotaWarningThresholds") as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "80,150");

    await user.click(screen.getByRole("button", { name: /settings\.buttons\.save/ }));

    await waitFor(() => {
      expect(screen.getByText(/settings\.errors\.quotaThresholdsInvalid/)).toBeInTheDocument();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows the localized inline error on submit when the overage factor is below 1", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<StorageGroupHarness onSubmit={onSubmit} />);

    const input = document.getElementById("reverseShareMaxOverageFactor") as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "0");

    await user.click(screen.getByRole("button", { name: /settings\.buttons\.save/ }));

    await waitFor(() => {
      expect(screen.getByText(/settings\.errors\.cleanupValueInvalid/)).toBeInTheDocument();
    });
    expect(screen.getByText(/"min":1/)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits when all values are within bounds", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<StorageGroupHarness onSubmit={onSubmit} />);

    await user.click(screen.getByRole("button", { name: /settings\.buttons\.save/ }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
  });
});
