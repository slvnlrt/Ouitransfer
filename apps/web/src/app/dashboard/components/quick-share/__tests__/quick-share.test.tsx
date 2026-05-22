import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Mock all dependencies
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/hooks/use-file-upload", () => ({
  useFileUpload: () => ({
    addFiles: vi.fn(),
    startUpload: vi.fn(),
    removeFile: vi.fn(),
    retryUpload: vi.fn(),
    clearAll: vi.fn(),
    fileUploads: [],
    isUploading: false,
  }),
}));

vi.mock("@/http/endpoints", () => ({
  createShare: vi.fn(),
  createShareAlias: vi.fn(),
  notifyRecipients: vi.fn(),
}));

vi.mock("@/lib/utils", () => ({
  customNanoid: () => "abc123test",
  cn: (...args: string[]) => args.filter(Boolean).join(" "),
}));

import { QuickShare } from "../quick-share";

describe("QuickShare", () => {
  it("renders the dropzone in initial state", () => {
    render(<QuickShare />);
    // Dropzone should show the title key
    expect(screen.getByText("title")).toBeInTheDocument();
  });

  it("renders the browse text", () => {
    render(<QuickShare />);
    expect(screen.getByText("browse")).toBeInTheDocument();
  });
});
