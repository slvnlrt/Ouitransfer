/**
 * Tests for ShareCreationModal — the unified share-creation flow.
 *
 * Covers the core contract that motivated the refactor:
 *   - The share is NOT persisted while navigating between steps (deferred
 *     creation) — only on a terminal action of the Link step.
 *   - "Later" creates the share without an alias.
 *   - "Create link" creates the share and then its alias.
 *   - A preselected item pre-fills the share name.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/http/endpoints", () => ({
  createShare: vi.fn(),
  createShareAlias: vi.fn(),
  listFiles: vi.fn(),
  listFolders: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/components/ui/lazy-qr-code", () => ({
  LazyQRCode: () => <div data-testid="qr-code" />,
}));

// The file tree is exercised elsewhere; here it would only add noise.
vi.mock("@/components/tables/files-tree", () => ({
  FileTree: () => <div data-testid="file-tree" />,
}));

vi.mock("@/hooks/use-copy-to-clipboard", () => ({
  useCopyToClipboard: () => ({ copy: vi.fn().mockResolvedValue(true) }),
}));

vi.mock("@/hooks/use-qr-download", () => ({
  useQrDownload: () => ({ isDownloading: false, downloadQr: vi.fn() }),
}));

import { ShareCreationModal } from "@/components/modals/share-creation-modal";
import { createShare, createShareAlias, listFiles, listFolders } from "@/http/endpoints";

const mockCreateShare = vi.mocked(createShare);
const mockCreateShareAlias = vi.mocked(createShareAlias);
const mockListFiles = vi.mocked(listFiles);
const mockListFolders = vi.mocked(listFolders);

// biome-ignore lint/suspicious/noExplicitAny: minimal stubs for axios-style responses
const asResponse = (data: unknown) => ({ data }) as any;

beforeEach(() => {
  vi.clearAllMocks();
  mockListFiles.mockResolvedValue(asResponse({ files: [] }));
  mockListFolders.mockResolvedValue(asResponse({ folders: [] }));
  mockCreateShare.mockResolvedValue(asResponse({ share: { id: "new-share-1" } }));
  mockCreateShareAlias.mockResolvedValue(asResponse({}));
});

const noop = () => {};

/** Fill the name field and advance to the Link step. */
async function gotoLinkStep() {
  const nameInput = document.querySelector("#share-name") as HTMLInputElement;
  fireEvent.change(nameInput, { target: { value: "My share" } });
  // "Next: Link" enables once the name is present.
  const nextButtons = screen.getAllByText("createShare.nextGenerateLink");
  fireEvent.click(nextButtons[0]);
  await screen.findByText("createShare.linkStepDescription");
}

describe("ShareCreationModal", () => {
  it("does not persist the share while navigating between steps", async () => {
    render(<ShareCreationModal isOpen onClose={noop} onSuccess={noop} />);
    await waitFor(() => expect(mockListFiles).toHaveBeenCalled());

    await gotoLinkStep();

    // Reaching the Link step must not have created anything yet.
    expect(mockCreateShare).not.toHaveBeenCalled();
    expect(mockCreateShareAlias).not.toHaveBeenCalled();
  });

  it("'Later' creates the share without an alias", async () => {
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    render(<ShareCreationModal isOpen onClose={onClose} onSuccess={onSuccess} />);
    await waitFor(() => expect(mockListFiles).toHaveBeenCalled());

    await gotoLinkStep();
    fireEvent.click(screen.getByText("generateShareLink.later"));

    await waitFor(() => expect(mockCreateShare).toHaveBeenCalledTimes(1));
    expect(mockCreateShareAlias).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("'Create link' creates the share and then its alias", async () => {
    render(<ShareCreationModal isOpen onClose={noop} onSuccess={noop} />);
    await waitFor(() => expect(mockListFiles).toHaveBeenCalled());

    await gotoLinkStep();
    fireEvent.click(screen.getByText("shareActions.generateLink"));

    await waitFor(() => expect(mockCreateShareAlias).toHaveBeenCalledTimes(1));
    expect(mockCreateShare).toHaveBeenCalledTimes(1);
    // The generated link is shown afterwards.
    await screen.findByText("shareActions.linkReady");
  });

  it("pre-fills the name from a single preselected file", async () => {
    render(
      <ShareCreationModal
        isOpen
        onClose={noop}
        onSuccess={noop}
        preselected={{ files: [{ id: "f1", name: "photo.png" }], folders: [] }}
      />,
    );
    await waitFor(() => expect(mockListFiles).toHaveBeenCalled());

    const nameInput = document.querySelector("#share-name") as HTMLInputElement;
    expect(nameInput.value).toBe("photo");
  });
});
