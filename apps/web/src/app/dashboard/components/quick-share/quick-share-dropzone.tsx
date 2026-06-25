"use client";

import { CloudUpload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useRef, useState } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface QuickShareDropzoneProps {
  onFilesAdded: (files: File[]) => void;
}

export function QuickShareDropzone({ onFilesAdded }: QuickShareDropzoneProps) {
  const t = useTranslations("quickShare.dropzone");
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    setIsDragOver(true);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      dragCounterRef.current = 0;

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        onFilesAdded(Array.from(files));
      }
    },
    [onFilesAdded],
  );

  const handleClick = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleClick();
      }
    },
    [handleClick],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        onFilesAdded(Array.from(files));
      }
      // Reset input so the same file can be selected again
      e.target.value = "";
    },
    [onFilesAdded],
  );

  return (
    <Card
      className={cn(
        "cursor-pointer transition-all duration-200 border-dashed border-2",
        isDragOver
          ? "border-primary bg-primary/5 scale-[1.01]"
          : "border-border/60 hover:border-primary/50 hover:bg-accent/30",
      )}
      role="button"
      tabIndex={0}
      aria-label={t("title")}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <CardContent className="py-12">
        <div className="flex flex-col items-center gap-4 text-center">
          <div
            className={cn(
              "w-16 h-16 rounded-full flex items-center justify-center transition-colors",
              isDragOver ? "bg-primary/15 text-primary" : "bg-primary/5 text-primary/60",
            )}
          >
            <CloudUpload className="size-8" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-foreground mb-1">
              {isDragOver ? t("dragActive") : t("title")}
            </h3>
            <p className="text-sm text-muted-foreground">{isDragOver ? "" : t("description")}</p>
            {!isDragOver && <p className="text-sm text-primary/70 mt-1">{t("browse")}</p>}
          </div>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileChange}
          tabIndex={-1}
          aria-hidden="true"
        />
      </CardContent>
    </Card>
  );
}
