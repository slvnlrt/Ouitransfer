"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, ImagePlus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  deleteBackgroundImage,
  listBackgroundImages,
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

  return (
    <Card>
      <CardHeader
        className="flex flex-row items-center justify-between cursor-pointer py-0"
        onClick={() => setIsCollapsed((prev) => !prev)}
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
            {images.map((image: BackgroundImage) => (
              <div key={image.id} className="group relative rounded-lg overflow-hidden border">
                <div className="aspect-video bg-muted">
                  <img
                    src={image.thumbnailUrl}
                    alt={image.name || "Background"}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="p-2 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground truncate">
                    {image.name || t("backgroundImages.untitled")}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => handleDelete(image.id)}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
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
