"use client";

import { AlertCircle, Building2, ChevronRight, FolderTree, Loader2, Network } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { browseLdapDirectory } from "@/http/endpoints/ldap";
import type { LdapConnectionFields, LdapDirectoryNode } from "@/http/endpoints/ldap/types";
import { cn } from "@/lib/utils";
import { parseApiError } from "@/utils/api-error";
import type { LdapConnectionValues, LdapDirectoryBrowserProps } from "../types";

/**
 * Per-node load lifecycle (tri-state, spec I-4):
 * - `unloaded`  — never expanded; expanding triggers a load.
 * - `loading`   — a browse request is in flight.
 * - `error`     — the load failed; a retry affordance is shown.
 * - `loaded`    — children loaded (may be empty → "no sub-containers").
 */
type NodeStatus = "unloaded" | "loading" | "error" | "loaded";

interface NodeState {
  node: LdapDirectoryNode;
  /** Tree depth (roots = 0), drives indentation and aria-level. */
  depth: number;
  status: NodeStatus;
  expanded: boolean;
  /** DNs of loaded children, in render order. */
  childDns: string[];
  errorMessage?: string;
}

type NodeMap = Record<string, NodeState>;

const iconForType: Record<LdapDirectoryNode["type"], typeof Building2> = {
  domain: Network,
  ou: FolderTree,
  container: Building2,
  group: Building2,
};

function toConnectionBody(connection: LdapConnectionValues): LdapConnectionFields {
  return {
    serverUrl: connection.serverUrl,
    bindDn: connection.bindDn,
    bindPassword: connection.bindPassword,
    useTls: connection.useTls,
    tlsSkipVerify: connection.tlsSkipVerify,
  };
}

/**
 * Flatten the loaded tree into the list of currently visible nodes (depth-first,
 * honouring `expanded`). Drives both rendering and roving-tabindex keyboard nav.
 */
function visibleNodes(rootDns: string[], nodes: NodeMap): NodeState[] {
  const out: NodeState[] = [];
  const walk = (dns: string[]) => {
    for (const dn of dns) {
      const state = nodes[dn];
      if (!state) continue;
      out.push(state);
      if (state.expanded && state.childDns.length > 0) {
        walk(state.childDns);
      }
    }
  };
  walk(rootDns);
  return out;
}

export function LdapDirectoryBrowser({
  open,
  onOpenChange,
  connection,
  onSelect,
}: LdapDirectoryBrowserProps) {
  const t = useTranslations();

  const [rootDns, setRootDns] = useState<string[]>([]);
  const [nodes, setNodes] = useState<NodeMap>({});
  const [defaultBaseDn, setDefaultBaseDn] = useState<string | null>(null);
  const [rootStatus, setRootStatus] = useState<NodeStatus>("loading");
  const [rootError, setRootError] = useState<string | null>(null);
  const [activeDn, setActiveDn] = useState<string | null>(null);

  // Refs to the rendered treeitem rows, keyed by DN, for roving-tabindex focus.
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Latest connection values, read at request time. The load effect depends on
  // `open` alone — if it depended on `connection` (a fresh object literal each
  // parent render) it would re-run on every form keystroke/background refetch
  // and collapse the admin's expanded subtree.
  const connectionRef = useRef(connection);
  connectionRef.current = connection;

  const loadRoots = useCallback(async () => {
    setRootStatus("loading");
    setRootError(null);
    try {
      const res = await browseLdapDirectory(toConnectionBody(connectionRef.current));
      const roots = res.data.nodes;
      const map: NodeMap = {};
      for (const node of roots) {
        map[node.dn] = {
          node,
          depth: 0,
          status: "unloaded",
          expanded: false,
          childDns: [],
        };
      }
      setNodes(map);
      setRootDns(roots.map((n) => n.dn));
      setDefaultBaseDn(res.data.defaultBaseDn);
      setRootStatus("loaded");
      setActiveDn(roots[0]?.dn ?? null);
    } catch (error) {
      setRootStatus("error");
      setRootError(parseApiError(error).message);
    }
  }, []);

  // (Re)load the naming-context roots each time the dialog opens. Connection
  // values are captured fresh on open so unsaved form edits are reflected.
  useEffect(() => {
    if (!open) return;
    setRootDns([]);
    setNodes({});
    setDefaultBaseDn(null);
    setActiveDn(null);
    rowRefs.current.clear();
    void loadRoots();
  }, [open, loadRoots]);

  const loadChildren = useCallback(async (dn: string) => {
    setNodes((prev) => {
      const target = prev[dn];
      if (!target) return prev;
      return { ...prev, [dn]: { ...target, status: "loading" } };
    });
    try {
      const res = await browseLdapDirectory({
        ...toConnectionBody(connectionRef.current),
        baseDn: dn,
      });
      const children = res.data.nodes;
      setNodes((prev) => {
        const target = prev[dn];
        if (!target) return prev;
        const next: NodeMap = { ...prev };
        for (const child of children) {
          next[child.dn] = {
            node: child,
            depth: target.depth + 1,
            status: "unloaded",
            expanded: false,
            childDns: [],
          };
        }
        next[dn] = {
          ...target,
          status: "loaded",
          expanded: true,
          childDns: children.map((c) => c.dn),
        };
        return next;
      });
    } catch (error) {
      const message = parseApiError(error).message;
      setNodes((prev) => {
        const target = prev[dn];
        if (!target) return prev;
        return { ...prev, [dn]: { ...target, status: "error", errorMessage: message } };
      });
    }
  }, []);

  const toggleExpand = useCallback(
    (dn: string) => {
      const state = nodes[dn];
      if (!state?.node.hasChildren) return;
      // Tri-state: load once. A loaded-empty node has no arrow, so it never
      // reaches here; loaded-with-children just toggles without refetching.
      if (state.status === "unloaded" || state.status === "error") {
        void loadChildren(dn);
        return;
      }
      if (state.status === "loaded" && state.childDns.length > 0) {
        setNodes((prev) => {
          const target = prev[dn];
          if (!target) return prev;
          return { ...prev, [dn]: { ...target, expanded: !target.expanded } };
        });
      }
    },
    [nodes, loadChildren],
  );

  const handleSelect = useCallback(
    (dn: string) => {
      onSelect(dn);
      onOpenChange(false);
    },
    [onSelect, onOpenChange],
  );

  const flat = visibleNodes(rootDns, nodes);

  const focusRow = useCallback((dn: string) => {
    setActiveDn(dn);
    rowRefs.current.get(dn)?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>, dn: string) => {
      const index = flat.findIndex((s) => s.node.dn === dn);
      if (index === -1) return;
      const state = flat[index];
      switch (event.key) {
        case "ArrowDown": {
          event.preventDefault();
          const next = flat[index + 1];
          if (next) focusRow(next.node.dn);
          break;
        }
        case "ArrowUp": {
          event.preventDefault();
          const prev = flat[index - 1];
          if (prev) focusRow(prev.node.dn);
          break;
        }
        case "ArrowRight": {
          event.preventDefault();
          if (state.node.hasChildren && !state.expanded) {
            toggleExpand(dn);
          } else if (state.expanded) {
            const next = flat[index + 1];
            if (next) focusRow(next.node.dn);
          }
          break;
        }
        case "ArrowLeft": {
          event.preventDefault();
          if (state.expanded) {
            toggleExpand(dn);
          } else {
            // Move focus to the parent, if any.
            const parent = flat
              .slice(0, index)
              .reverse()
              .find((s) => s.depth < state.depth);
            if (parent) focusRow(parent.node.dn);
          }
          break;
        }
        case "Enter":
        case " ": {
          event.preventDefault();
          handleSelect(dn);
          break;
        }
      }
    },
    [flat, focusRow, toggleExpand, handleSelect],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("ldap.browse.directory.title")}</DialogTitle>
          <DialogDescription>{t("ldap.browse.directory.description")}</DialogDescription>
        </DialogHeader>

        {defaultBaseDn && (
          <Button
            type="button"
            variant="secondary"
            className="w-full justify-start gap-2"
            onClick={() => handleSelect(defaultBaseDn)}
          >
            <Network className="h-4 w-4 shrink-0" />
            <span className="truncate">
              {t("ldap.browse.directory.useDetectedBase")}
              <span className="ml-1 font-mono text-xs text-muted-foreground">{defaultBaseDn}</span>
            </span>
          </Button>
        )}

        <div className="min-h-[12rem] rounded-md border p-1">
          {rootStatus === "loading" && (
            <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("ldap.browse.directory.loading")}
            </div>
          )}

          {rootStatus === "error" && (
            <div className="flex flex-col items-start gap-2 p-3 text-sm">
              <div className="flex items-center gap-2 text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{rootError ?? t("ldap.browse.error")}</span>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => void loadRoots()}>
                {t("ldap.browse.retry")}
              </Button>
            </div>
          )}

          {rootStatus === "loaded" && flat.length === 0 && (
            <p className="p-3 text-sm text-muted-foreground">
              {t("ldap.browse.directory.noRoots")}
            </p>
          )}

          {rootStatus === "loaded" && flat.length > 0 && (
            <div role="tree" aria-label={t("ldap.browse.directory.title")}>
              {flat.map((state) => {
                const { node, depth, status, expanded, childDns } = state;
                const Icon = iconForType[node.type];
                const isActive = activeDn === node.dn;
                const loadedEmpty = status === "loaded" && childDns.length === 0;
                // The arrow shows only while the node may still have children.
                const showArrow = node.hasChildren && !loadedEmpty;
                return (
                  <div key={node.dn}>
                    <div
                      ref={(el) => {
                        if (el) rowRefs.current.set(node.dn, el);
                        else rowRefs.current.delete(node.dn);
                      }}
                      role="treeitem"
                      aria-level={depth + 1}
                      // Expandable only while the node may still have children;
                      // a loaded-empty container is announced as a leaf (no state).
                      aria-expanded={showArrow ? expanded : undefined}
                      tabIndex={isActive ? 0 : -1}
                      onKeyDown={(e) => handleKeyDown(e, node.dn)}
                      onClick={() => setActiveDn(node.dn)}
                      onFocus={() => setActiveDn(node.dn)}
                      className={cn(
                        "flex cursor-pointer items-center gap-1 rounded px-1 py-1.5 text-sm outline-none",
                        isActive ? "bg-accent" : "hover:bg-accent/50",
                      )}
                      style={{ paddingInlineStart: `${depth * 1.25 + 0.25}rem` }}
                    >
                      {showArrow ? (
                        <button
                          type="button"
                          tabIndex={-1}
                          aria-label={
                            expanded
                              ? t("ldap.browse.directory.collapse")
                              : t("ldap.browse.directory.expand")
                          }
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleExpand(node.dn);
                          }}
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-accent"
                        >
                          {status === "loading" ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <ChevronRight
                              className={cn(
                                "h-3.5 w-3.5 transition-transform",
                                expanded && "rotate-90",
                              )}
                            />
                          )}
                        </button>
                      ) : (
                        <span className="h-5 w-5 shrink-0" />
                      )}
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelect(node.dn);
                        }}
                        className="min-w-0 flex-1 truncate text-start"
                        title={node.dn}
                      >
                        {node.name}
                      </button>
                    </div>

                    {status === "error" && (
                      <div
                        className="flex items-center gap-2 py-1 text-xs text-destructive"
                        style={{ paddingInlineStart: `${(depth + 1) * 1.25 + 0.25}rem` }}
                      >
                        <AlertCircle className="h-3 w-3 shrink-0" />
                        <span>{state.errorMessage ?? t("ldap.browse.error")}</span>
                        <button
                          type="button"
                          onClick={() => toggleExpand(node.dn)}
                          className="underline"
                        >
                          {t("ldap.browse.retry")}
                        </button>
                      </div>
                    )}

                    {loadedEmpty && (
                      <p
                        className="py-1 text-xs text-muted-foreground"
                        style={{ paddingInlineStart: `${(depth + 1) * 1.25 + 0.25}rem` }}
                      >
                        {t("ldap.browse.directory.noSubContainers")}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
