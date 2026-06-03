/**
 * Tests for the 5.2 "cleanup" settings group (admin lifecycle settings).
 *
 * Covers:
 *   - The exported settings schema validates the cleanup integer bounds,
 *     mirroring the server-side `intMin` validators in config-validation.ts.
 *   - The SettingsGroup component renders the cleanup group: Switch widgets for
 *     the boolean toggles and number inputs for the integer thresholds.
 *   - Out-of-bounds numeric input produces the localized inline validation error
 *     on submit (the `superRefine` path), and valid input submits cleanly.
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
// can assert that the localized cleanup error carries the correct `min` bound.
vi.mock("next-intl", () => ({
  useTranslations: () => {
    const t = (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key;
    return t;
  },
}));

// ── Imports after mocks ─────────────────────────────────────────────────────
import { CLEANUP_INT_BOUNDS, createSettingsSchema, isValidIntMin } from "../../hooks/use-settings";
import type { Config, GroupFormData } from "../../types";
import { SettingsGroup } from "../settings-group";

// A non-interpolating translator for building the schema in unit tests.
const t = ((key: string, values?: Record<string, unknown>) =>
  values ? `${key}:${JSON.stringify(values)}` : key) as never;

const CLEANUP_CONFIGS: Config[] = [
  { key: "autoCleanupEnabled", value: "false", group: "cleanup", type: "boolean" },
  { key: "autoCleanupIntervalHours", value: "24", group: "cleanup", type: "number" },
  { key: "autoCleanupGracePeriodDays", value: "7", group: "cleanup", type: "number" },
  { key: "autoCleanupNotifyDaysBefore", value: "3", group: "cleanup", type: "number" },
  { key: "maxViewsCleanupDays", value: "30", group: "cleanup", type: "number" },
  {
    key: "accountDeactivationCleanupEnabled",
    value: "false",
    group: "cleanup",
    type: "boolean",
  },
  { key: "accountDeactivationCleanupDays", value: "30", group: "cleanup", type: "number" },
  { key: "autoCleanupOrphansEnabled", value: "false", group: "cleanup", type: "boolean" },
  { key: "autoCleanupOrphanMinAgeHours", value: "24", group: "cleanup", type: "number" },
];

function CleanupGroupHarness({ onSubmit }: { onSubmit: (data: GroupFormData) => Promise<void> }) {
  const form = useForm<GroupFormData>({
    resolver: zodResolver(createSettingsSchema(t)),
    defaultValues: {
      configs: Object.fromEntries(CLEANUP_CONFIGS.map((c) => [c.key, c.value])),
    },
  });

  return (
    <SettingsGroup
      group="cleanup"
      configs={CLEANUP_CONFIGS}
      form={form}
      isCollapsed={false}
      onToggleCollapse={() => {}}
      onSubmit={onSubmit}
    />
  );
}

describe("cleanup settings schema", () => {
  it("declares bounds for every integer cleanup key (and no boolean keys)", () => {
    expect(CLEANUP_INT_BOUNDS).toEqual({
      autoCleanupIntervalHours: 1,
      autoCleanupGracePeriodDays: 0,
      autoCleanupNotifyDaysBefore: 0,
      maxViewsCleanupDays: 1,
      accountDeactivationCleanupDays: 1,
      autoCleanupOrphanMinAgeHours: 1,
    });
  });

  it("isValidIntMin mirrors the server intMin validator", () => {
    expect(isValidIntMin("1", 1)).toBe(true);
    expect(isValidIntMin("0", 0)).toBe(true);
    expect(isValidIntMin("0", 1)).toBe(false);
    expect(isValidIntMin("", 0)).toBe(false);
    expect(isValidIntMin("  ", 0)).toBe(false);
    expect(isValidIntMin("2.5", 1)).toBe(false);
    expect(isValidIntMin("-1", 0)).toBe(false);
  });

  it("rejects an out-of-bounds value via the schema superRefine", () => {
    const schema = createSettingsSchema(t);
    const result = schema.safeParse({
      configs: { autoCleanupIntervalHours: "0" },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path.join(".") === "configs.autoCleanupIntervalHours",
      );
      expect(issue?.message).toContain("settings.errors.cleanupValueInvalid");
      expect(issue?.message).toContain('"min":1');
    }
  });

  it("flags notifyDaysBefore greater than the grace period (cross-field rule)", () => {
    const schema = createSettingsSchema(t);
    const result = schema.safeParse({
      configs: {
        autoCleanupGracePeriodDays: "3",
        autoCleanupNotifyDaysBefore: "5",
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path.join(".") === "configs.autoCleanupNotifyDaysBefore",
      );
      expect(issue?.message).toContain("settings.errors.notifyDaysExceedsGrace");
    }
  });

  it("accepts notifyDaysBefore equal to the grace period (cross-field rule)", () => {
    const schema = createSettingsSchema(t);
    const result = schema.safeParse({
      configs: {
        autoCleanupGracePeriodDays: "7",
        autoCleanupNotifyDaysBefore: "7",
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts in-bounds values via the schema", () => {
    const schema = createSettingsSchema(t);
    const result = schema.safeParse({
      configs: {
        autoCleanupIntervalHours: "24",
        autoCleanupGracePeriodDays: "0",
        autoCleanupNotifyDaysBefore: "0",
        maxViewsCleanupDays: "1",
        accountDeactivationCleanupDays: "1",
        autoCleanupOrphanMinAgeHours: "1",
      },
    });
    expect(result.success).toBe(true);
  });
});

describe("cleanup settings group rendering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a Switch for each boolean toggle and a number input for each threshold", () => {
    render(<CleanupGroupHarness onSubmit={vi.fn()} />);

    // Three boolean toggles → three switches.
    expect(screen.getAllByRole("switch")).toHaveLength(3);

    // Integer thresholds render as number inputs.
    for (const key of Object.keys(CLEANUP_INT_BOUNDS)) {
      const input = document.getElementById(key) as HTMLInputElement | null;
      expect(input).not.toBeNull();
      expect(input?.type).toBe("number");
    }
  });

  it("shows the localized inline error on submit when a value is out of bounds", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<CleanupGroupHarness onSubmit={onSubmit} />);

    const input = document.getElementById("autoCleanupIntervalHours") as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "0");

    await user.click(screen.getByRole("button", { name: /settings\.buttons\.save/ }));

    await waitFor(() => {
      expect(screen.getByText(/settings\.errors\.cleanupValueInvalid/)).toBeInTheDocument();
    });
    // Carries the correct bound for this key.
    expect(screen.getByText(/"min":1/)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits when all values are within bounds", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<CleanupGroupHarness onSubmit={onSubmit} />);

    await user.click(screen.getByRole("button", { name: /settings\.buttons\.save/ }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
  });
});
