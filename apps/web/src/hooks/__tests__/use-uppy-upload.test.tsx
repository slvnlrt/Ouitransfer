/**
 * @vitest-environment jsdom
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const uppyState = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  files: [] as Array<{ id: string; meta: Record<string, unknown> }>,
  awsOptions: undefined as
    | {
        completeMultipartUpload: (
          file: unknown,
          data: {
            uploadId: string;
            key: string;
            parts: Array<{ PartNumber: number; ETag: string }>;
            signal: AbortSignal;
          },
        ) => Promise<unknown>;
      }
    | undefined,
}));

vi.mock("@uppy/core", () => ({
  default: class FakeUppy {
    use(_plugin: unknown, options: typeof uppyState.awsOptions) {
      uppyState.awsOptions = options;
      return this;
    }

    on(event: string, handler: (...args: unknown[]) => unknown) {
      uppyState.handlers.set(event, handler);
      return this;
    }

    off(event: string) {
      uppyState.handlers.delete(event);
      return this;
    }

    getFiles() {
      return uppyState.files;
    }

    setFileMeta(fileId: string, metadata: Record<string, unknown>) {
      uppyState.files = uppyState.files.map((file) =>
        file.id === fileId ? { ...file, meta: { ...file.meta, ...metadata } } : file,
      );
    }

    removeFile() {}
  },
}));

vi.mock("@uppy/aws-s3", () => ({ default: class FakeAwsS3 {} }));

const stableT = (key: string) => key;
vi.mock("next-intl", () => ({ useTranslations: () => stableT }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));
vi.mock("@/http/endpoints/files", () => ({
  abortMultipartUpload: vi.fn(),
  completeMultipartUpload: vi.fn(),
  createMultipartUpload: vi.fn(),
  getMultipartPartUrl: vi.fn(),
}));

import { useUppyUpload } from "../use-uppy-upload";

function requiredCustomMultipartFunctions() {
  return {
    createMultipartUpload: vi.fn(),
    getMultipartPartUrl: vi.fn(),
    completeMultipartUpload: vi.fn().mockResolvedValue({ fileId: "reverse-file-1" }),
    abortMultipartUpload: vi.fn(),
    listParts: vi.fn(),
  };
}

describe("useUppyUpload multipart registration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uppyState.handlers.clear();
    uppyState.files = [];
    uppyState.awsOptions = undefined;
  });

  it("does not register a reverse-share file twice after multipart completion", async () => {
    const onAfterUpload = vi.fn().mockResolvedValue("duplicate-file-id");
    const customMultipartFunctions = requiredCustomMultipartFunctions();
    const { result, unmount } = renderHook(() =>
      useUppyUpload({
        getPresignedUrl: vi.fn(),
        onAfterUpload,
        customMultipartFunctions,
      }),
    );

    const browserFile = new File(["payload"], "VIDEO Surveillance.7z", {
      type: "application/x-7z-compressed",
    });
    const uppyFile = {
      id: "uppy-file-1",
      name: browserFile.name,
      data: browserFile,
      meta: { objectName: "reverse-shares/rs-1/object.7z" },
    };
    uppyState.files = [uppyFile];

    await act(async () => {
      uppyState.handlers.get("file-added")?.(uppyFile);
    });

    await act(async () => {
      await uppyState.awsOptions?.completeMultipartUpload(uppyFile, {
        uploadId: "upload-1",
        key: "reverse-shares/rs-1/object.7z",
        parts: [{ PartNumber: 1, ETag: "etag-1" }],
        signal: new AbortController().signal,
      });
      await uppyState.handlers.get("upload-success")?.(uppyState.files[0]);
    });

    expect(customMultipartFunctions.completeMultipartUpload).toHaveBeenCalledWith(
      "upload-1",
      "reverse-shares/rs-1/object.7z",
      [{ PartNumber: 1, ETag: "etag-1" }],
      browserFile,
    );
    expect(onAfterUpload).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(result.current.fileUploads[0]?.registeredFileId).toBe("reverse-file-1"),
    );

    unmount();
  });

  it("still registers a simple PUT upload exactly once", async () => {
    const onAfterUpload = vi.fn().mockResolvedValue("simple-file-1");
    const { result, unmount } = renderHook(() =>
      useUppyUpload({
        getPresignedUrl: vi.fn(),
        onAfterUpload,
      }),
    );

    const browserFile = new File(["payload"], "small.txt", { type: "text/plain" });
    const uppyFile = {
      id: "simple-uppy-file",
      name: browserFile.name,
      data: browserFile,
      meta: { objectName: "reverse-shares/rs-1/small.txt" },
    };
    uppyState.files = [uppyFile];

    await act(async () => {
      uppyState.handlers.get("file-added")?.(uppyFile);
      await uppyState.handlers.get("upload-success")?.(uppyFile);
    });

    expect(onAfterUpload).toHaveBeenCalledTimes(1);
    expect(onAfterUpload).toHaveBeenCalledWith(
      "simple-uppy-file",
      browserFile,
      "reverse-shares/rs-1/small.txt",
    );
    await waitFor(() =>
      expect(result.current.fileUploads[0]?.registeredFileId).toBe("simple-file-1"),
    );

    unmount();
  });
});
