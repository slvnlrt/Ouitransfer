/**
 * Tests for IdentificationForm component.
 *
 * Covers:
 *   - Shows error message and Retry button when metadata fails to load
 *   - Shows loader when metadata is loading (null, no error)
 *   - Shows name/email fields based on metadata configuration
 *   - Validation gate: required fields block submission
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock dependencies ─────────────────────────────────────────────────────────

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

// ── Imports after mocks ───────────────────────────────────────────────────────

import type { ShareMetadata } from "@/http/endpoints/shares/types";
import { IdentificationForm } from "../identification-form";

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE_METADATA: ShareMetadata = {
  name: "Test Share",
  description: null,
  totalFiles: 3,
  totalFolders: 1,
  hasPassword: false,
  isExpired: false,
  isMaxViewsReached: false,
  nameFieldRequired: "REQUIRED",
  emailFieldRequired: "OPTIONAL",
};

function renderForm(overrides: Partial<Parameters<typeof IdentificationForm>[0]> = {}) {
  const defaultProps = {
    isOpen: true,
    metadata: BASE_METADATA,
    metadataError: false,
    refetchMetadata: vi.fn(),
    isSubmitting: false,
    onSubmit: vi.fn(),
    ...overrides,
  };
  return { ...render(<IdentificationForm {...defaultProps} />), props: defaultProps };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("IdentificationForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows error message and Retry button when metadataError is true", () => {
    const refetch = vi.fn();
    renderForm({ metadata: null, metadataError: true, refetchMetadata: refetch });

    expect(screen.getByText("share.identification.metadataError")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "common.retry" })).toBeInTheDocument();
  });

  it("calls refetchMetadata when Retry button is clicked", async () => {
    const user = userEvent.setup();
    const refetch = vi.fn();
    renderForm({ metadata: null, metadataError: true, refetchMetadata: refetch });

    await user.click(screen.getByRole("button", { name: "common.retry" }));

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("shows loader when metadata is null and no error", () => {
    renderForm({ metadata: null, metadataError: false });

    // Loader renders with role="status"
    expect(screen.getByRole("status")).toBeInTheDocument();
    // No form fields should be visible
    expect(screen.queryByLabelText("share.identification.nameLabel")).not.toBeInTheDocument();
  });

  it("shows name field when nameFieldRequired is not HIDDEN", () => {
    renderForm({ metadata: { ...BASE_METADATA, nameFieldRequired: "REQUIRED" } });

    expect(screen.getByLabelText(/share\.identification\.nameLabel/)).toBeInTheDocument();
  });

  it("hides name field when nameFieldRequired is HIDDEN", () => {
    renderForm({ metadata: { ...BASE_METADATA, nameFieldRequired: "HIDDEN" } });

    expect(screen.queryByLabelText(/share\.identification\.nameLabel/)).not.toBeInTheDocument();
  });

  it("shows email field when emailFieldRequired is not HIDDEN", () => {
    renderForm({ metadata: { ...BASE_METADATA, emailFieldRequired: "OPTIONAL" } });

    expect(screen.getByLabelText(/share\.identification\.emailLabel/)).toBeInTheDocument();
  });

  it("validates required name field blocks submission", async () => {
    const onSubmit = vi.fn();
    renderForm({
      metadata: { ...BASE_METADATA, nameFieldRequired: "REQUIRED", emailFieldRequired: "HIDDEN" },
      onSubmit,
    });

    // Use fireEvent.submit to bypass native HTML5 constraint validation
    // (jsdom's requestSubmit() blocks on required="" which prevents handleSubmit from running)
    const form = screen.getByRole("dialog").querySelector("form")!;
    fireEvent.submit(form);

    // Validation error should show after re-render
    await waitFor(() => {
      expect(screen.getByText("share.identification.nameRequired")).toBeInTheDocument();
    });
    // onSubmit should NOT be called
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("validates email format when email is provided", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderForm({
      metadata: { ...BASE_METADATA, nameFieldRequired: "HIDDEN", emailFieldRequired: "OPTIONAL" },
      onSubmit,
    });

    const emailInput = screen.getByLabelText(/share\.identification\.emailLabel/);
    await user.type(emailInput, "not-an-email");

    // Use fireEvent.submit to bypass native HTML5 type="email" constraint validation
    const form = screen.getByRole("dialog").querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByText("share.identification.emailInvalid")).toBeInTheDocument();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits successfully with valid data", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderForm({
      metadata: {
        ...BASE_METADATA,
        nameFieldRequired: "REQUIRED",
        emailFieldRequired: "OPTIONAL",
      },
      onSubmit,
    });

    const nameInput = screen.getByLabelText(/share\.identification\.nameLabel/);
    await user.type(nameInput, "John Doe");

    await user.click(screen.getByRole("button", { name: "share.identification.submit" }));

    expect(onSubmit).toHaveBeenCalledWith("John Doe", undefined);
  });

  it("disables submit button when isSubmitting is true", () => {
    renderForm({ isSubmitting: true });

    expect(screen.getByRole("button", { name: "share.identification.submit" })).toBeDisabled();
  });
});
