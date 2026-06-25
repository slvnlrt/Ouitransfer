import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useQuickShare } from "../use-quick-share";

// Mock useFileUpload — uses a mutable array that tests populate before
// calling hook actions.  The mock is returned via getters so each render
// reads the latest snapshot.
const mockAddFiles = vi.fn();
const mockStartUpload = vi.fn();
const mockRemoveFile = vi.fn();
const mockClearAll = vi.fn();
const mockRetryUpload = vi.fn();
let mockFileUploads: Array<{
  id: string;
  file: File;
  status: string;
  progress: number;
  objectName?: string;
  registeredFileId?: string;
}> = [];

vi.mock("@/hooks/use-file-upload", () => ({
  useFileUpload: () => ({
    addFiles: mockAddFiles,
    startUpload: mockStartUpload,
    removeFile: mockRemoveFile,
    retryUpload: mockRetryUpload,
    clearAll: mockClearAll,
    get fileUploads() {
      return mockFileUploads;
    },
    get isUploading() {
      return mockFileUploads.some((f) => f.status === "uploading");
    },
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
    mockFileUploads = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts in dropzone state", () => {
    const { result } = renderHook(() => useQuickShare());
    expect(result.current.state).toBe("dropzone");
  });

  it("transitions to uploading state when files are added", async () => {
    const file = new File(["test"], "test.txt");
    // Simulate addFiles populating pending entries (new array = new reference)
    mockAddFiles.mockImplementation(() => {
      mockFileUploads = [{ id: "file-1", file, status: "pending", progress: 0 }];
    });

    const { result } = renderHook(() => useQuickShare());

    act(() => {
      result.current.handleFilesAdded([file]);
    });

    expect(result.current.state).toBe("uploading");
    expect(mockAddFiles).toHaveBeenCalled();
    // Advance timers to trigger the 200ms useEffect for startUpload
    await act(async () => {
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

  it("starts upload for files added while already in uploading state", async () => {
    const fileA = new File(["a"], "a.txt");
    const fileB = new File(["b"], "b.txt");
    let callCount = 0;

    // First call: initial drop adds one pending file
    // Second call: second drop adds another pending file
    mockAddFiles.mockImplementation((files: File[]) => {
      callCount++;
      if (callCount === 1) {
        mockFileUploads = [{ id: "file-1", file: files[0], status: "pending", progress: 0 }];
      } else {
        mockFileUploads = [
          { id: "file-1", file: fileA, status: "uploading", progress: 50 },
          { id: "file-2", file: files[0], status: "pending", progress: 0 },
        ];
      }
    });

    const { result } = renderHook(() => useQuickShare());

    // First drop
    act(() => {
      result.current.handleFilesAdded([fileA]);
    });
    expect(result.current.state).toBe("uploading");

    // Clear the mock call count so we can verify the second startUpload call
    mockStartUpload.mockClear();

    // Second drop while uploading
    act(() => {
      result.current.handleFilesAdded([fileB]);
    });

    // After timer fires, startUpload should have been called for the new pending files
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current.state).toBe("uploading");
    expect(mockStartUpload).toHaveBeenCalled();
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
