"use client";

import { IconDotsVertical, IconDownload } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import type { ComponentType } from "react";

import { Button } from "@/components/ui/button";
import { ContextMenuContent, ContextMenuItem } from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** A single action in a file/folder action menu. */
export interface ActionItem {
  key: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  variant?: "destructive";
}

// ─── Dropdown Menu ───────────────────────────────────────────────────────────

interface ItemDropdownMenuProps {
  /** The list of actions to show in the dropdown. Falsy items are filtered out. */
  actions: ActionItem[];
  /** In share mode, only a download button is shown instead of the full dropdown. */
  isShareMode: boolean;
  /** Called when the download button is clicked in share mode. */
  onShareModeDownload?: () => void;
  /** CSS class for the trigger button. */
  triggerClassName?: string;
  /** Screen-reader label for the trigger button. */
  menuSrLabel?: string;
}

export function ItemDropdownMenu({
  actions,
  isShareMode,
  onShareModeDownload,
  triggerClassName = "h-8 w-8 hover:bg-muted cursor-pointer",
  menuSrLabel,
}: ItemDropdownMenuProps) {
  const t = useTranslations();

  if (isShareMode) {
    if (!onShareModeDownload) return null;
    return (
      <Button
        size="icon"
        variant="ghost"
        className={triggerClassName}
        onClick={(e) => {
          e.stopPropagation();
          onShareModeDownload();
        }}
      >
        <IconDownload className="h-4 w-4" />
        <span className="sr-only">{t("filesTable.actions.download")}</span>
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={triggerClassName}
          onClick={(e) => e.stopPropagation()}
        >
          <IconDotsVertical className="h-4 w-4" />
          <span className="sr-only">{menuSrLabel ?? t("filesTable.actions.menu")}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[200px]">
        {actions.map((action) => (
          <DropdownMenuItem
            key={action.key}
            className={`cursor-pointer py-2${action.variant === "destructive" ? " text-destructive focus:text-destructive" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              action.onClick();
            }}
          >
            <action.icon className="h-4 w-4" />
            {action.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── Context Menu (for grid cards) ───────────────────────────────────────────

interface ItemContextMenuActionsProps {
  /** The same action list used by the dropdown — renders as context menu items. */
  actions: ActionItem[];
}

/**
 * Renders context menu items from an action list.
 * Use inside a `<ContextMenu>` wrapper.
 */
export function ItemContextMenuActions({ actions }: ItemContextMenuActionsProps) {
  return (
    <ContextMenuContent className="w-[200px]">
      {actions.map((action) => (
        <ContextMenuItem
          key={action.key}
          className={`cursor-pointer py-2${action.variant === "destructive" ? " text-destructive focus:text-destructive" : ""}`}
          variant={action.variant === "destructive" ? "destructive" : undefined}
          onClick={(e) => {
            e.stopPropagation();
            action.onClick();
          }}
        >
          <action.icon className="h-4 w-4" />
          {action.label}
        </ContextMenuItem>
      ))}
    </ContextMenuContent>
  );
}
