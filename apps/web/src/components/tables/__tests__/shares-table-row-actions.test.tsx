/**
 * Tests for ShareRowActions lifecycle affordances (Phase A.1).
 *
 * Verifies which action the owner menu surfaces per lifecycle state:
 *   - active            → Pause
 *   - deactivated/manual → Resume
 *   - deactivated/expired|max_views → Renew (NOT resume — server would refuse it)
 * and that clicking each fires the matching handler.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import { ShareRowActions } from "@/components/tables/shares-table-row-actions";
import type { Share } from "@/http/endpoints/shares/types";
import type { ShareLifecycleState } from "@/lib/share-lifecycle";

function makeShare(overrides: Partial<Share> = {}): Share {
  return {
    id: "share-1",
    name: "Test share",
    description: null,
    expiration: null,
    views: 0,
    maxViews: null,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    creatorId: "user-1",
    security: { hasPassword: false },
    files: [],
    folders: [],
    recipients: [],
    alias: null,
    nameFieldRequired: "HIDDEN",
    emailFieldRequired: "HIDDEN",
    notifyOnDownload: false,
    inactivityAlertDays: null,
    lastDownloadedAt: null,
    notifiedForExpiring: false,
    notifiedForExpired: false,
    isActive: true,
    deactivatedAt: null,
    deactivationReason: null,
    ...overrides,
  };
}

function renderActions(
  lifecycle: ShareLifecycleState,
  handlers: {
    onPauseShare?: (share: Share) => void;
    onResumeShare?: (share: Share) => void;
    onRenewShare?: (share: Share) => void;
  } = {},
) {
  const noop = vi.fn();
  return render(
    <ShareRowActions
      share={makeShare()}
      lifecycle={lifecycle}
      smtpEnabled="false"
      onDelete={noop}
      onEdit={noop}
      onPauseShare={handlers.onPauseShare}
      onResumeShare={handlers.onResumeShare}
      onRenewShare={handlers.onRenewShare}
      onManageFiles={noop}
      onManageRecipients={noop}
      onViewDetails={noop}
      onGenerateLink={noop}
      onCopyLink={noop}
      onNotifyRecipients={noop}
    />,
  );
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "sharesTable.actions.menu" }));
}

describe("ShareRowActions lifecycle affordances", () => {
  it("shows Pause (and not Resume/Renew) for an active share", async () => {
    const user = userEvent.setup();
    const onPauseShare = vi.fn();
    renderActions({ kind: "active" }, { onPauseShare });
    await openMenu(user);

    const pause = screen.getByText("sharesTable.actions.pause");
    expect(pause).toBeInTheDocument();
    expect(screen.queryByText("sharesTable.actions.resume")).not.toBeInTheDocument();
    expect(screen.queryByText("sharesTable.actions.renew")).not.toBeInTheDocument();

    await user.click(pause);
    expect(onPauseShare).toHaveBeenCalledTimes(1);
  });

  it("shows Resume (and not Pause/Renew) for a manually-paused share", async () => {
    const user = userEvent.setup();
    const onResumeShare = vi.fn();
    renderActions({ kind: "deactivated", reason: "manual" }, { onResumeShare });
    await openMenu(user);

    const resume = screen.getByText("sharesTable.actions.resume");
    expect(resume).toBeInTheDocument();
    expect(screen.queryByText("sharesTable.actions.pause")).not.toBeInTheDocument();
    expect(screen.queryByText("sharesTable.actions.renew")).not.toBeInTheDocument();

    await user.click(resume);
    expect(onResumeShare).toHaveBeenCalledTimes(1);
  });

  it("shows Renew (and not Resume) for an expired share", async () => {
    const user = userEvent.setup();
    const onRenewShare = vi.fn();
    renderActions({ kind: "deactivated", reason: "expired" }, { onRenewShare });
    await openMenu(user);

    const renew = screen.getByText("sharesTable.actions.renew");
    expect(renew).toBeInTheDocument();
    expect(screen.queryByText("sharesTable.actions.resume")).not.toBeInTheDocument();
    expect(screen.queryByText("sharesTable.actions.pause")).not.toBeInTheDocument();

    await user.click(renew);
    expect(onRenewShare).toHaveBeenCalledTimes(1);
  });

  it("shows Renew for a max_views-reached share", async () => {
    const user = userEvent.setup();
    const onRenewShare = vi.fn();
    renderActions({ kind: "deactivated", reason: "max_views" }, { onRenewShare });
    await openMenu(user);

    expect(screen.getByText("sharesTable.actions.renew")).toBeInTheDocument();
    expect(screen.queryByText("sharesTable.actions.resume")).not.toBeInTheDocument();
  });
});
