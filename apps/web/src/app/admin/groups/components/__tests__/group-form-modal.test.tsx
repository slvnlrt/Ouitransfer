/**
 * Tests for the LDAP-group-DN browse integration in the group form modal (5.5
 * follow-up). The modal sources the LDAP connection from the saved config and
 * reuses the LdapGroupSearch dialog so the AD group DN can be picked instead of
 * typed.
 *
 * Covers:
 *   - The Browse button shows only when LDAP is configured (with a search base).
 *   - Picking a group writes its DN into the ldapDn field.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { useForm } from "react-hook-form";
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

const getLdapConfig = vi.fn();
const searchLdapGroups = vi.fn();
vi.mock("@/http/endpoints/ldap", () => ({
  getLdapConfig: () => getLdapConfig(),
  searchLdapGroups: (...args: unknown[]) => searchLdapGroups(...args),
}));

import type { GroupFormData } from "../../hooks/use-group-management";
import { GroupFormModal } from "../group-form-modal";

const CONFIGURED = {
  configured: true,
  enabled: true,
  serverUrl: "ldaps://ad.corp.local:636",
  bindDn: "svc",
  searchBase: "DC=corp,DC=local",
  useTls: true,
  tlsSkipVerify: false,
};

function Harness() {
  const formMethods = useForm<GroupFormData>({
    defaultValues: { name: "Engineering", description: "", ldapDn: "" },
  });
  return (
    <GroupFormModal
      isOpen
      onClose={vi.fn()}
      modalMode="edit"
      selectedGroup={null}
      formMethods={formMethods}
      onSubmit={vi.fn()}
    />
  );
}

function renderModal() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<Harness />, { wrapper });
}

beforeEach(() => {
  getLdapConfig.mockReset();
  searchLdapGroups.mockReset();
});

describe("GroupFormModal — LDAP group browse", () => {
  it("hides the Browse button when LDAP is not configured", async () => {
    getLdapConfig.mockResolvedValue({ data: { configured: false } });

    renderModal();

    // The ldapDn field renders…
    expect(
      await screen.findByPlaceholderText("groups.form.ldapDn.placeholder"),
    ).toBeInTheDocument();
    // …but no Browse affordance (LDAP isn't set up).
    expect(screen.queryByLabelText("ldap.browse.groups.buttonLabel")).not.toBeInTheDocument();
  });

  it("shows the Browse button when configured and writes the picked DN into ldapDn", async () => {
    const user = userEvent.setup();
    getLdapConfig.mockResolvedValue({ data: CONFIGURED });
    searchLdapGroups.mockResolvedValue({
      data: {
        groups: [
          { dn: "CN=Admins,DC=corp,DC=local", name: "Admins", type: "group", hasChildren: false },
        ],
        truncated: false,
      },
    });

    renderModal();

    const browseButton = await screen.findByLabelText("ldap.browse.groups.buttonLabel");
    await user.click(browseButton);

    // The reused group-search dialog opens; search and pick a group.
    await user.type(await screen.findByPlaceholderText("ldap.browse.groups.placeholder"), "adm");
    const result = await screen.findByText("Admins");
    await user.click(result);

    // The connection came from the saved config; the password is empty so the
    // server reuses the stored one.
    await waitFor(() =>
      expect(searchLdapGroups).toHaveBeenCalledWith(
        expect.objectContaining({
          serverUrl: CONFIGURED.serverUrl,
          bindDn: CONFIGURED.bindDn,
          bindPassword: "",
          searchBase: CONFIGURED.searchBase,
          query: "adm",
        }),
      ),
    );

    // The picked DN is written into the ldapDn field.
    await waitFor(() =>
      expect(screen.getByPlaceholderText("groups.form.ldapDn.placeholder")).toHaveValue(
        "CN=Admins,DC=corp,DC=local",
      ),
    );
  });
});
