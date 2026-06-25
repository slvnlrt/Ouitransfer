"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";

import { IconCell } from "./icon-cell";

const ICONS_PER_BATCH = 100;
const SCROLL_THRESHOLD = 200;
/** Delay after intersection observer fires to batch icon loads and avoid layout thrashing */
const INTERSECTION_BATCH_DELAY_MS = 50;

export interface IconEntry {
  name: string;
  packSlug: string;
  category: string;
}

interface VirtualizedIconGridProps {
  entries: IconEntry[];
  onIconSelect: (iconName: string) => void;
  showCategories?: boolean;
}

export function VirtualizedIconGrid({ entries, onIconSelect, showCategories = false }: VirtualizedIconGridProps) {
  const t = useTranslations();
  const [visibleCount, setVisibleCount] = useState(ICONS_PER_BATCH);
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (observerEntries) => {
        const entry = observerEntries[0];
        if (entry.isIntersecting && visibleCount < entries.length && !isLoading) {
          setIsLoading(true);
          setTimeout(() => {
            setVisibleCount((prev) => Math.min(prev + ICONS_PER_BATCH, entries.length));
            setIsLoading(false);
          }, INTERSECTION_BATCH_DELAY_MS);
        }
      },
      {
        root: scrollRef.current,
        rootMargin: `${SCROLL_THRESHOLD}px`,
        threshold: 0.1,
      },
    );

    observer.observe(sentinel);

    return () => {
      observer.unobserve(sentinel);
    };
  }, [visibleCount, entries.length, isLoading]);

  // Reset visible count when entries change (new search/tab)
  useEffect(() => {
    setVisibleCount(ICONS_PER_BATCH);
  }, [entries]);

  const visibleEntries = useMemo(() => entries.slice(0, visibleCount), [entries, visibleCount]);

  // Group by category (only used when showCategories is true, but always computed for hook rules)
  const entriesByCategory = useMemo(() => {
    if (!showCategories) return [];
    const grouped = new Map<string, IconEntry[]>();
    for (const entry of visibleEntries) {
      const list = grouped.get(entry.category);
      if (list) {
        list.push(entry);
      } else {
        grouped.set(entry.category, [entry]);
      }
    }
    return Array.from(grouped.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [visibleEntries, showCategories]);

  // Count totals per category from ALL entries (not just visible)
  const categoryTotals = useMemo(() => {
    if (!showCategories) return new Map<string, number>();
    const counts = new Map<string, number>();
    for (const entry of entries) {
      counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
    }
    return counts;
  }, [entries, showCategories]);

  if (showCategories) {
    return (
      <div ref={scrollRef} className="max-h-[600px] overflow-y-auto overflow-x-hidden pe-2">
        <div className="space-y-6">
          {entriesByCategory.map(([category, categoryEntries]) => (
            <div key={category}>
              <Badge variant="secondary" className="text-xs mb-3">
                {t("iconPicker.categoryBadge", {
                  category,
                  count: categoryTotals.get(category) ?? categoryEntries.length,
                })}
              </Badge>
              <div className="grid grid-cols-8 sm:grid-cols-12 lg:grid-cols-[repeat(16,minmax(0,1fr))] xl:grid-cols-[repeat(20,minmax(0,1fr))] gap-2 sm:gap-3">
                {categoryEntries.map((entry) => (
                  <IconCell
                    key={entry.name}
                    iconName={entry.name}
                    packSlug={entry.packSlug}
                    onSelect={onIconSelect}
                    title={entry.name}
                  />
                ))}
              </div>
            </div>
          ))}

          {/* Loading indicator and sentinel */}
          <div ref={sentinelRef} className="flex justify-center py-4">
            {isLoading && <div className="text-sm text-muted-foreground">{t("iconPicker.loadingMore")}</div>}
            {visibleCount >= entries.length && entries.length > 0 && (
              <div className="text-sm text-muted-foreground">
                {t("iconPicker.allIconsLoaded", { count: entries.length.toLocaleString() })}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="max-h-[600px] overflow-y-auto overflow-x-hidden pe-2">
      <div className="grid grid-cols-8 sm:grid-cols-12 lg:grid-cols-[repeat(16,minmax(0,1fr))] xl:grid-cols-[repeat(20,minmax(0,1fr))] gap-2 sm:gap-3">
        {visibleEntries.map((entry) => (
          <IconCell
            key={entry.name}
            iconName={entry.name}
            packSlug={entry.packSlug}
            onSelect={onIconSelect}
            title={`${entry.name} (${entry.category})`}
          />
        ))}
      </div>

      <div ref={sentinelRef} className="flex justify-center py-4">
        {isLoading && <div className="text-sm text-muted-foreground">{t("iconPicker.loadingMore")}</div>}
        {visibleCount >= entries.length && entries.length > 0 && (
          <div className="text-sm text-muted-foreground">
            {t("iconPicker.allIconsLoaded", { count: entries.length.toLocaleString() })}
          </div>
        )}
      </div>
    </div>
  );
}
