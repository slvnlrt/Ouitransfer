/**
 * Tests for the LDAP group-search dialog (5.5 Lot 2).
 *
 * Covers:
 *   - A debounced query calls the search endpoint and renders results.
 *   - Race-safety (M-4): a newer query's results win even when an older query's
 *     response resolves later — TanStack Query keys by the query string.
 *   - Selecting a group calls `onSelect(dn)` and closes the dialog.
 *   - The `truncated` flag surfaces the "refine your search" hint.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values && "count" in values ? `${key}:${values.count}` : key,
}));

const searchLdapGroups = vi.fn();
vi.mock("@/http/endpoints/ldap", () => ({
  searchLdapGroups: (...args: unknown[]) => searchLdapGroups(...args),
}));

import type { LdapGroupSearchResult } from "@/http/endpoints/ldap/types";
import type { LdapConnectionValues } from "../../types";
import { LdapGroupSearch } from "../ldap-group-search";

const connection: LdapConnectionValues = {
  serverUrl: "ldaps://ad.corp.local:636",
  bindDn: "svc",
  bindPassword: "secret",
  useTls: true,
  tlsSkipVerify: false,
};

function ok(data: LdapGroupSearchResult) {
  return { data };
}

function renderDialog(props: Partial<Parameters<typeof LdapGroupSearch>[0]> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(
    <LdapGroupSearch
      open
      onOpenChange={vi.fn()}
      connection={connection}
      searchBase="DC=corp,DC=local"
      onSelect={vi.fn()}
      {...props}
    />,
    { wrapper },
  );
}

beforeEach(() => {
  searchLdapGroups.mockReset();
});

describe("LdapGroupSearch", () => {
  it("debounces input then queries and renders results", async () => {
    const user = userEvent.setup();
    searchLdapGroups.mockResolvedValue(
      ok({
        groups: [
          { dn: "CN=Admins,DC=corp,DC=local", name: "Admins", type: "group", hasChildren: false },
        ],
        truncated: false,
      }),
    );

    renderDialog();

    await user.type(screen.getByPlaceholderText("ldap.browse.groups.placeholder"), "adm");

    await waitFor(() => {
      expect(searchLdapGroups).toHaveBeenCalledWith(
        expect.objectContaining({ query: "adm", searchBase: "DC=corp,DC=local" }),
      );
    });
    expect(await screen.findByText("Admins")).toBeInTheDocument();
  });

  it("renders only the latest query's results (race-safe)", async () => {
    const user = userEvent.setup();
    // "ad" resolves slowly with stale data; "admin" resolves fast with fresh data.
    searchLdapGroups.mockImplementation(({ query }: { query: string }) => {
      if (query === "ad") {
        return new Promise((resolve) =>
          setTimeout(
            () =>
              resolve(
                ok({
                  groups: [
                    {
                      dn: "CN=Stale,DC=corp,DC=local",
                      name: "Stale",
                      type: "group",
                      hasChildren: false,
                    },
                  ],
                  truncated: false,
                }),
              ),
            200,
          ),
        );
      }
      return Promise.resolve(
        ok({
          groups: [
            { dn: "CN=Fresh,DC=corp,DC=local", name: "Fresh", type: "group", hasChildren: false },
          ],
          truncated: false,
        }),
      );
    });

    renderDialog();
    const input = screen.getByPlaceholderText("ldap.browse.groups.placeholder");
    await user.type(input, "ad");
    await user.type(input, "min");

    expect(await screen.findByText("Fresh")).toBeInTheDocument();
    // Even after the slow "ad" response would have resolved, the stale row never appears.
    await new Promise((r) => setTimeout(r, 250));
    expect(screen.queryByText("Stale")).not.toBeInTheDocument();
    expect(screen.getByText("Fresh")).toBeInTheDocument();
  });

  it("selecting a group calls onSelect and closes the dialog", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();
    searchLdapGroups.mockResolvedValue(
      ok({
        groups: [
          { dn: "CN=Admins,DC=corp,DC=local", name: "Admins", type: "group", hasChildren: false },
        ],
        truncated: false,
      }),
    );

    renderDialog({ onSelect, onOpenChange });
    await user.type(screen.getByPlaceholderText("ldap.browse.groups.placeholder"), "adm");

    const result = await screen.findByText("Admins");
    await user.click(result);

    expect(onSelect).toHaveBeenCalledWith("CN=Admins,DC=corp,DC=local");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows the truncated hint when results are capped", async () => {
    const user = userEvent.setup();
    searchLdapGroups.mockResolvedValue(
      ok({
        groups: [{ dn: "CN=A,DC=corp,DC=local", name: "A", type: "group", hasChildren: false }],
        truncated: true,
      }),
    );

    renderDialog();
    await user.type(screen.getByPlaceholderText("ldap.browse.groups.placeholder"), "a");

    expect(await screen.findByText("ldap.browse.groups.truncated")).toBeInTheDocument();
  });
});
