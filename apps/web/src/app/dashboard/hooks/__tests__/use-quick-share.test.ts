import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useQuickShare } from "../use-quick-share";

// Mock useFileUpload
const mockAddFiles = vi.fn();
const mockStartUpload = vi.fn();
const mockRemoveFile = vi.fn();
const mockClearAll = vi.fn();
const mockFileUploads: Array<{
  id: string;
  file: File;
  status: string;
  progress: number;
  objectName?: string;
  registeredFileId?: string;
}> = [];

const mockRetryUpload = vi.fn();

vi.mock("@/hooks/use-file-upload", () => ({
  useFileUpload: () => ({
    addFiles: mockAddFiles,
    startUpload: mockStartUpload,
    removeFile: mockRemoveFile,
    retryUpload: mockRetryUpload,
    clearAll: mockClearAll,
    fileUploads: mockFileUploads,
    isUploading: mockFileUploads.some((f) => f.status === "uploading"),
  }),
}));

// Mock share API
vi.mock("@/http/endpoints", () => ({
  createShare: vi.fn(),
  createShareAlias: vi.fn(),
  notifyRecipients: vi.fn(),
}));

// Mock next-intl — returns key with count param interpolated so "toContain('3')" works
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) => {
    if (params && typeof params.count !== "undefined") {
      return `${key}|${params.count}`;
    }
    return key;
  },
}));

// Mock utils
vi.mock("@/lib/utils", () => ({
  customNanoid: () => "abc123test",
  cn: (...args: string[]) => args.join(" "),
}));

// Mock sonner
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

describe("useQuickShare", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockFileUploads.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts in dropzone state", () => {
    const { result } = renderHook(() => useQuickShare());
    expect(result.current.state).toBe("dropzone");
  });

  it("transitions to uploading state when files are added", () => {
    const { result } = renderHook(() => useQuickShare());

    act(() => {
      result.current.handleFilesAdded([new File(["test"], "test.txt")]);
    });

    expect(result.current.state).toBe("uploading");
    expect(mockAddFiles).toHaveBeenCalled();
    // Advance timers to trigger the 200ms setTimeout for startUpload
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(mockStartUpload).toHaveBeenCalled();
  });

  it("sets default name to filename for single file", () => {
    const { result } = renderHook(() => useQuickShare());

    act(() => {
      result.current.handleFilesAdded([new File(["test"], "report.pdf")]);
    });

    expect(result.current.settings.name).toBe("report.pdf");
  });

  it("sets default name to file count for multiple files", () => {
    const { result } = renderHook(() => useQuickShare());

    act(() => {
      result.current.handleFilesAdded([
        new File(["a"], "a.txt"),
        new File(["b"], "b.txt"),
        new File(["c"], "c.txt"),
      ]);
    });

    // Uses i18n key pattern — mock returns "quickShare.upload.defaultName|3"
    expect(result.current.settings.name).toContain("3");
  });

  it("does not auto-rename after user manually edits the name", () => {
    const { result } = renderHook(() => useQuickShare());

    act(() => {
      result.current.handleFilesAdded([new File(["a"], "report.pdf")]);
    });
    expect(result.current.settings.name).toBe("report.pdf");

    // User edits the name manually
    act(() => {
      result.current.updateSettings({ name: "My custom name" });
    });

    // Adding more files should NOT change the name
    act(() => {
      result.current.handleFilesAdded([new File(["b"], "b.txt")]);
    });
    expect(result.current.settings.name).toBe("My custom name");
  });

  it("validates email addresses", () => {
    const { result } = renderHook(() => useQuickShare());
    expect(result.current.isValidEmail("test@example.com")).toBe(true);
    expect(result.current.isValidEmail("notanemail")).toBe(false);
    expect(result.current.isValidEmail("")).toBe(false);
  });

  it("resets to dropzone state on reset", () => {
    const { result } = renderHook(() => useQuickShare());

    act(() => {
      result.current.handleFilesAdded([new File(["test"], "test.txt")]);
    });
    expect(result.current.state).toBe("uploading");

    act(() => {
      result.current.reset();
    });
    expect(result.current.state).toBe("dropzone");
    expect(mockClearAll).toHaveBeenCalled();
  });

  it("exposes smtpEnabled from options", () => {
    const { result } = renderHook(() => useQuickShare({ smtpEnabled: "true" }));
    expect(result.current.smtpEnabled).toBe("true");
  });

  it("defaults smtpEnabled to 'false'", () => {
    const { result } = renderHook(() => useQuickShare());
    expect(result.current.smtpEnabled).toBe("false");
  });
});
