"use client";

import { memo, useEffect, useState } from "react";
import type { IconType } from "react-icons";

import { getCachedIcon, loadIcon } from "./icon-loader";

interface IconCellProps {
  iconName: string;
  packSlug: string;
  onSelect: (iconName: string) => void;
  title?: string;
}

/**
 * A single icon cell in the picker grid.
 * Lazily loads the icon component when mounted (i.e., when scrolled into view
 * via the virtualized grid's progressive rendering).
 */
export const IconCell = memo(function IconCell({ iconName, packSlug, onSelect, title }: IconCellProps) {
  const [Icon, setIcon] = useState<IconType | null | undefined>(() => getCachedIcon(packSlug, iconName));

  useEffect(() => {
    // Already resolved
    if (Icon !== undefined) return;

    let cancelled = false;

    loadIcon(packSlug, iconName).then((icon) => {
      if (!cancelled) setIcon(icon);
    });

    return () => {
      cancelled = true;
    };
    // biome-ignore lint/correctness/useExhaustiveDependencies: Icon is read only as a guard (if Icon !== undefined return); it must not be a dep or the effect re-runs after it resolves
  }, [iconName, packSlug]);

  return (
    <button
      type="button"
      className="h-12 w-12 sm:h-14 sm:w-14 p-0 hover:bg-muted transition-colors flex-shrink-0 rounded-md flex items-center justify-center cursor-pointer"
      onClick={() => onSelect(iconName)}
      title={title ?? iconName}
    >
      {Icon === undefined ? (
        // Loading placeholder
        <span className="h-5 w-5 rounded bg-muted animate-pulse" />
      ) : Icon === null ? (
        // Failed to load — show name abbreviation
        <span className="text-xs text-muted-foreground">{iconName.slice(0, 2)}</span>
      ) : (
        <Icon size={24} />
      )}
    </button>
  );
});
