"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Loader2, Search, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { searchLdapGroups } from "@/http/endpoints/ldap";
import type { LdapConnectionFields, LdapGroupSearchResult } from "@/http/endpoints/ldap/types";
import { parseApiError } from "@/utils/api-error";
import type { LdapConnectionValues, LdapGroupSearchProps } from "../types";

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 1;

function toConnectionBody(connection: LdapConnectionValues): LdapConnectionFields {
  return {
    serverUrl: connection.serverUrl,
    bindDn: connection.bindDn,
    bindPassword: connection.bindPassword,
    useTls: connection.useTls,
    tlsSkipVerify: connection.tlsSkipVerify,
  };
}

export function LdapGroupSearch({
  open,
  onOpenChange,
  connection,
  searchBase,
  onSelect,
}: LdapGroupSearchProps) {
  const t = useTranslations();
  const [input, setInput] = useState("");
  const [debounced, setDebounced] = useState("");

  // Reset the input each time the dialog opens.
  useEffect(() => {
    if (open) {
      setInput("");
      setDebounced("");
    }
  }, [open]);

  // Debounce the raw input into the value the query is keyed by.
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(input.trim()), DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [input]);

  const enabled = open && debounced.length >= MIN_QUERY_LENGTH;

  // Race-safety (spec M-4): the query is keyed by the debounced string, so a slow
  // response for an older query (e.g. "ad") can never overwrite a newer one
  // ("admin") — TanStack Query only renders the data of the active query key.
  const { data, isFetching, isError, error, refetch } = useQuery<LdapGroupSearchResult>({
    queryKey: ["ldap", "search-groups", searchBase, debounced],
    enabled,
    staleTime: 30_000,
    retry: false,
    queryFn: async () => {
      const res = await searchLdapGroups({
        ...toConnectionBody(connection),
        searchBase,
        query: debounced,
      });
      return res.data;
    },
  });

  const handleSelect = useCallback(
    (dn: string) => {
      onSelect(dn);
      onOpenChange(false);
    },
    [onSelect, onOpenChange],
  );

  const groups = data?.groups ?? [];
  const showResults = enabled && !isFetching && !isError;
  const errorMessage = isError ? parseApiError(error).message : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("ldap.browse.groups.title")}</DialogTitle>
          <DialogDescription>{t("ldap.browse.groups.description")}</DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 start-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t("ldap.browse.groups.placeholder")}
            aria-label={t("ldap.browse.groups.placeholder")}
            className="ps-9"
          />
        </div>

        {/* Announce the result count for screen readers. */}
        <div aria-live="polite" className="sr-only">
          {showResults ? t("ldap.browse.groups.resultCount", { count: groups.length }) : ""}
        </div>

        <div className="min-h-[10rem] rounded-md border p-1">
          {!enabled && (
            <p className="p-3 text-sm text-muted-foreground">{t("ldap.browse.groups.prompt")}</p>
          )}

          {enabled && isFetching && (
            <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("ldap.browse.groups.searching")}
            </div>
          )}

          {enabled && isError && (
            <div className="flex flex-col items-start gap-2 p-3 text-sm">
              <div className="flex items-center gap-2 text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{errorMessage ?? t("ldap.browse.error")}</span>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
                {t("ldap.browse.retry")}
              </Button>
            </div>
          )}

          {showResults && groups.length === 0 && (
            <p className="p-3 text-sm text-muted-foreground">{t("ldap.browse.groups.empty")}</p>
          )}

          {showResults && groups.length > 0 && (
            <ul className="space-y-0.5">
              {groups.map((group) => (
                <li key={group.dn}>
                  <button
                    type="button"
                    onClick={() => handleSelect(group.dn)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-start text-sm hover:bg-accent"
                    title={group.dn}
                  >
                    <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{group.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {showResults && data?.truncated && (
          <p className="text-xs text-muted-foreground">{t("ldap.browse.groups.truncated")}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
