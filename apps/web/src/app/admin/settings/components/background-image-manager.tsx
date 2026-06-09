"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, ImagePlus, Pencil, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  deleteBackgroundImage,
  listBackgroundImages,
  reorderBackgroundImages,
  updateBackgroundImage,
  uploadBackgroundImage,
} from "@/http/endpoints/background-images";
import type { BackgroundImage } from "@/http/endpoints/background-images/types";
import { queryKeys } from "@/lib/query-keys";

export function BackgroundImageManager() {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.backgroundImages.list(),
    queryFn: async () => {
      const res = await listBackgroundImages();
      return res.data.images;
    },
  });

  const images = data ?? [];

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteBackgroundImage(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.backgroundImages.all });
      toast.success(t("backgroundImages.deleteSuccess"));
    },
    onError: () => {
      toast.error(t("backgroundImages.deleteError"));
    },
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => updateBackgroundImage(id, { name }),
    onMutate: async ({ id, name }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.backgroundImages.list() });
      const previous = queryClient.getQueryData<BackgroundImage[]>(
        queryKeys.backgroundImages.list(),
      );
      queryClient.setQueryData<BackgroundImage[]>(queryKeys.backgroundImages.list(), (old) =>
        old?.map((img) => (img.id === id ? { ...img, name } : img)),
      );
      return { previous };
    },
    onSuccess: () => {
      toast.success(t("backgroundImages.renameSuccess"));
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.backgroundImages.list(), context.previous);
      }
      toast.error(t("backgroundImages.renameError"));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.backgroundImages.all });
    },
  });

  const reorderMutation = useMutation({
    mutationFn: (ids: string[]) => reorderBackgroundImages(ids),
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.backgroundImages.list() });
      const previous = queryClient.getQueryData<BackgroundImage[]>(
        queryKeys.backgroundImages.list(),
      );
      if (previous) {
        const byId = new Map(previous.map((img) => [img.id, img]));
        const reordered = ids
          .map((id, index) => {
            const img = byId.get(id);
            return img ? { ...img, sortOrder: index } : undefined;
          })
          .filter((img): img is BackgroundImage => img !== undefined);
        queryClient.setQueryData<BackgroundImage[]>(queryKeys.backgroundImages.list(), reordered);
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.backgroundImages.list(), context.previous);
      }
      toast.error(t("backgroundImages.reorderError"));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.backgroundImages.all });
    },
  });

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      await uploadBackgroundImage(file);
      queryClient.invalidateQueries({ queryKey: queryKeys.backgroundImages.all });
      toast.success(t("backgroundImages.uploadSuccess"));
    } catch {
      toast.error(t("backgroundImages.uploadError"));
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleDelete = (id: string) => {
    if (window.confirm(t("backgroundImages.deleteConfirm"))) {
      deleteMutation.mutate(id);
    }
  };

  const startEditing = (image: BackgroundImage) => {
    setEditingId(image.id);
    setEditingName(image.name ?? "");
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditingName("");
  };

  const saveEditing = () => {
    if (!editingId) return;
    const trimmed = editingName.trim();
    if (!trimmed) {
      // Backend requires non-empty name — cancel edit
      cancelEditing();
      return;
    }
    renameMutation.mutate({ id: editingId, name: trimmed });
    setEditingId(null);
    setEditingName("");
  };

  const handleMove = (index: number, direction: "up" | "down") => {
    const newImages = [...images];
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newImages.length) return;
    [newImages[index], newImages[targetIndex]] = [newImages[targetIndex], newImages[index]];
    reorderMutation.mutate(newImages.map((img) => img.id));
  };

  return (
    <Card>
      <CardHeader
        className="flex flex-row items-center justify-between cursor-pointer select-none py-0"
        onClick={() => setIsCollapsed((prev) => !prev)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setIsCollapsed((prev) => !prev);
          }
        }}
        role="button"
        tabIndex={0}
        aria-expanded={!isCollapsed}
      >
        <div className="flex flex-row items-center gap-8">
          <ImagePlus className="text-xl text-muted-foreground" />
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold">{t("settings.groups.backgrounds.title")}</h2>
            <p className="text-sm text-muted-foreground">
              {t("settings.groups.backgrounds.description")}
            </p>
          </div>
        </div>
        {isCollapsed ? (
          <ChevronDown className="text-muted-foreground" />
        ) : (
          <ChevronUp className="text-muted-foreground" />
        )}
      </CardHeader>
      <CardContent className={isCollapsed ? "hidden" : "block"}>
        <Separator className="my-6" />

        {isLoading ? (
          <div className="text-sm text-muted-foreground">{t("common.loading")}</div>
        ) : images.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("backgroundImages.empty")}</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {images.map((image: BackgroundImage, index: number) => (
              <div key={image.id} className="group relative rounded-lg overflow-hidden border">
                <div className="aspect-video bg-muted">
                  <img
                    src={image.thumbnailUrl}
                    alt={image.name ?? "Background"}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="p-2 space-y-1">
                  {/* Name: inline editable */}
                  {editingId === image.id ? (
                    <Input
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onBlur={saveEditing}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveEditing();
                        if (e.key === "Escape") cancelEditing();
                      }}
                      className="h-6 text-xs"
                      autoFocus
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => startEditing(image)}
                      className="flex items-center gap-1 text-xs text-muted-foreground truncate hover:text-foreground transition-colors bg-transparent border-0 p-0 cursor-pointer"
                      title={t("backgroundImages.rename")}
                    >
                      <span className="truncate">
                        {image.name ?? t("backgroundImages.untitled")}
                      </span>
                      <Pencil className="h-2.5 w-2.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </button>
                  )}

                  {/* Action buttons: reorder + delete */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-0.5">
                      {images.length > 1 && index > 0 && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5"
                          onClick={() => handleMove(index, "up")}
                          disabled={reorderMutation.isPending}
                          title={t("backgroundImages.moveUp")}
                        >
                          <ChevronUp className="h-3 w-3" />
                        </Button>
                      )}
                      {images.length > 1 && index < images.length - 1 && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5"
                          onClick={() => handleMove(index, "down")}
                          disabled={reorderMutation.isPending}
                          title={t("backgroundImages.moveDown")}
                        >
                          <ChevronDown className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => handleDelete(image.id)}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleUpload}
          />
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2"
          >
            <ImagePlus className="h-4 w-4" />
            {uploading ? t("backgroundImages.uploading") : t("backgroundImages.add")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
