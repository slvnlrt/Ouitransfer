"use client";

import { useQuery } from "@tanstack/react-query";
import { ImageIcon, Shuffle } from "lucide-react";
import { useTranslations } from "next-intl";

import { listBackgroundImages } from "@/http/endpoints/background-images";
import type { BackgroundImage } from "@/http/endpoints/background-images/types";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";

interface BackgroundImagePickerProps {
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  showEmptyHint?: boolean;
}

export function BackgroundImagePicker({
  value,
  onChange,
  showEmptyHint = false,
}: BackgroundImagePickerProps) {
  const t = useTranslations();

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.backgroundImages.list(),
    queryFn: async () => {
      const res = await listBackgroundImages();
      return res.data.images;
    },
  });

  const images = data ?? [];

  if (isLoading) {
    return (
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="aspect-video rounded-lg bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  if (images.length === 0) {
    if (!showEmptyHint) {
      return null;
    }
    return (
      <div className="flex items-center gap-3 rounded-lg border bg-muted/50 p-3">
        <ImageIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">
          {t("reverseShares.form.backgroundImage.none")}
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">{t("reverseShares.form.backgroundImage.title")}</p>
      <p className="text-xs text-muted-foreground">
        {t("reverseShares.form.backgroundImage.description")}
      </p>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {/* Random option */}
        <button
          type="button"
          onClick={() => onChange(null)}
          className={cn(
            "relative aspect-video rounded-lg border-2 flex items-center justify-center bg-muted transition-all",
            value === null || value === undefined
              ? "border-primary ring-2 ring-primary/20"
              : "border-transparent hover:border-muted-foreground/30",
          )}
        >
          <div className="flex flex-col items-center gap-1">
            <Shuffle className="h-5 w-5 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground font-medium">
              {t("reverseShares.form.backgroundImage.random")}
            </span>
          </div>
        </button>

        {/* Image options */}
        {images.map((image: BackgroundImage) => (
          <button
            key={image.id}
            type="button"
            onClick={() => onChange(image.id)}
            className={cn(
              "relative aspect-video rounded-lg border-2 overflow-hidden transition-all",
              value === image.id
                ? "border-primary ring-2 ring-primary/20"
                : "border-transparent hover:border-muted-foreground/30",
            )}
          >
            <img
              src={image.thumbnailUrl}
              alt={image.name || "Background"}
              className="w-full h-full object-cover"
            />
          </button>
        ))}
      </div>
    </div>
  );
}
