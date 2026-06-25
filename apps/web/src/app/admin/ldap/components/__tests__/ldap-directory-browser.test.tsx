/**
 * Tests for the LDAP directory-browser dialog (5.5 Lot 2).
 *
 * Covers:
 *   - On open, the naming-context roots are loaded and rendered.
 *   - "Use detected base" is shown when `defaultBaseDn` is set, absent when null.
 *   - Expanding a container lazily loads its children (tri-state), and a load
 *     returning [] collapses to the "no sub-containers" row.
 *   - Selecting a node calls `onSelect(dn)` and closes the dialog.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  // Radix Dialog uses pointer-capture APIs jsdom lacks.
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

// next-intl — key passthrough; ICU `{count}` is interpolated for the live region.
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values && "count" in values ? `${key}:${values.count}` : key,
}));

const browseLdapDirectory = vi.fn();
vi.mock("@/http/endpoints/ldap", () => ({
  browseLdapDirectory: (...args: unknown[]) => browseLdapDirectory(...args),
}));

import type { LdapBrowseResult } from "@/http/endpoints/ldap/types";
import type { LdapConnectionValues } from "../../types";
import { LdapDirectoryBrowser } from "../ldap-directory-browser";

const connection: LdapConnectionValues = {
  serverUrl: "ldaps://ad.corp.local:636",
  bindDn: "svc",
  bindPassword: "secret",
  useTls: true,
  tlsSkipVerify: false,
};

function ok(data: LdapBrowseResult) {
  return { data };
}

beforeEach(() => {
  browseLdapDirectory.mockReset();
});

describe("LdapDirectoryBrowser", () => {
  it("loads naming-context roots on open and shows the detected-base action", async () => {
    browseLdapDirectory.mockResolvedValueOnce(
      ok({
        nodes: [{ dn: "DC=corp,DC=local", name: "corp.local", type: "domain", hasChildren: true }],
        defaultBaseDn: "DC=corp,DC=local",
      }),
    );

    render(
      <LdapDirectoryBrowser
        open
        onOpenChange={vi.fn()}
        connection={connection}
        onSelect={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("corp.local")).toBeInTheDocument();
    });
    // No baseDn on the first call → roots.
    expect(browseLdapDirectory).toHaveBeenCalledWith(
      expect.not.objectContaining({ baseDn: expect.anything() }),
    );
    expect(screen.getByText("ldap.browse.directory.useDetectedBase")).toBeInTheDocument();
  });

  it("hides the detected-base action when defaultBaseDn is null", async () => {
    browseLdapDirectory.mockResolvedValueOnce(
      ok({
        nodes: [
          { dn: "dc=example,dc=org", name: "dc=example,dc=org", type: "domain", hasChildren: true },
        ],
        defaultBaseDn: null,
      }),
    );

    render(
      <LdapDirectoryBrowser
        open
        onOpenChange={vi.fn()}
        connection={connection}
        onSelect={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("dc=example,dc=org")).toBeInTheDocument();
    });
    expect(screen.queryByText("ldap.browse.directory.useDetectedBase")).not.toBeInTheDocument();
  });

  it("lazily loads children on expand and shows 'no sub-containers' when empty", async () => {
    const user = userEvent.setup();
    browseLdapDirectory
      // roots
      .mockResolvedValueOnce(
        ok({
          nodes: [
            { dn: "DC=corp,DC=local", name: "corp.local", type: "domain", hasChildren: true },
          ],
          defaultBaseDn: null,
        }),
      )
      // children of the root → empty
      .mockResolvedValueOnce(ok({ nodes: [], defaultBaseDn: null }));

    render(
      <LdapDirectoryBrowser
        open
        onOpenChange={vi.fn()}
        connection={connection}
        onSelect={vi.fn()}
      />,
    );

    const root = await screen.findByRole("treeitem");
    const expandButton = within(root).getByRole("button", {
      name: "ldap.browse.directory.expand",
    });
    await user.click(expandButton);

    await waitFor(() => {
      expect(browseLdapDirectory).toHaveBeenCalledWith(
        expect.objectContaining({ baseDn: "DC=corp,DC=local" }),
      );
    });
    await waitFor(() => {
      expect(screen.getByText("ldap.browse.directory.noSubContainers")).toBeInTheDocument();
    });
  });

  it("expands and renders loaded child nodes", async () => {
    const user = userEvent.setup();
    browseLdapDirectory
      .mockResolvedValueOnce(
        ok({
          nodes: [
            { dn: "DC=corp,DC=local", name: "corp.local", type: "domain", hasChildren: true },
          ],
          defaultBaseDn: null,
        }),
      )
      .mockResolvedValueOnce(
        ok({
          nodes: [
            { dn: "OU=Users,DC=corp,DC=local", name: "Users", type: "ou", hasChildren: false },
          ],
          defaultBaseDn: null,
        }),
      );

    render(
      <LdapDirectoryBrowser
        open
        onOpenChange={vi.fn()}
        connection={connection}
        onSelect={vi.fn()}
      />,
    );

    const root = await screen.findByRole("treeitem");
    await user.click(within(root).getByRole("button", { name: "ldap.browse.directory.expand" }));

    await waitFor(() => {
      expect(screen.getByText("Users")).toBeInTheDocument();
    });
  });

  it("selecting a node calls onSelect and closes the dialog", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();
    browseLdapDirectory.mockResolvedValueOnce(
      ok({
        nodes: [{ dn: "DC=corp,DC=local", name: "corp.local", type: "domain", hasChildren: true }],
        defaultBaseDn: null,
      }),
    );

    render(
      <LdapDirectoryBrowser
        open
        onOpenChange={onOpenChange}
        connection={connection}
        onSelect={onSelect}
      />,
    );

    const label = await screen.findByText("corp.local");
    await user.click(label);

    expect(onSelect).toHaveBeenCalledWith("DC=corp,DC=local");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("selecting the detected base calls onSelect with the detected DN", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    browseLdapDirectory.mockResolvedValueOnce(
      ok({
        nodes: [{ dn: "DC=corp,DC=local", name: "corp.local", type: "domain", hasChildren: true }],
        defaultBaseDn: "DC=corp,DC=local",
      }),
    );

    render(
      <LdapDirectoryBrowser
        open
        onOpenChange={vi.fn()}
        connection={connection}
        onSelect={onSelect}
      />,
    );

    const action = await screen.findByText("ldap.browse.directory.useDetectedBase");
    await user.click(action);
    expect(onSelect).toHaveBeenCalledWith("DC=corp,DC=local");
  });
});
