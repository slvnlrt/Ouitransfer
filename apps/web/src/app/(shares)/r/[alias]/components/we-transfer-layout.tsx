"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Clock, Info, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { LanguageSwitcher } from "@/components/general/language-switcher";
import { ModeToggle } from "@/components/general/mode-toggle";
import { listBackgroundImages } from "@/http/endpoints/background-images";
import { logger } from "@/lib/logger";
import { queryKeys } from "@/lib/query-keys";
import { MESSAGE_TYPES } from "../constants";
import type { WeTransferLayoutProps } from "../types";
import { FileUploadSection } from "./file-upload-section";
import { WeTransferStatusMessage } from "./shared/status-message";
import { TransparentFooter } from "./transparent-footer";

const GRADIENT_FALLBACK =
  "linear-gradient(135deg, oklch(0.3 0.1 265), oklch(0.15 0.05 280), oklch(0.25 0.08 250))";

type BackgroundState = { mode: "loading" } | { mode: "image"; url: string } | { mode: "gradient" };

function useDynamicBackground(backgroundImageId: string | null | undefined): BackgroundState {
  const [state, setState] = useState<BackgroundState>({ mode: "loading" });
  // Stable random seed — computed once per component mount, survives re-renders
  const [randomSeed] = useState(() => Math.random());

  // Always fetch the list — it contains presigned fullUrl for each image
  const { data: imageList } = useQuery({
    queryKey: queryKeys.backgroundImages.list(),
    queryFn: async () => {
      const res = await listBackgroundImages();
      return res.data.images;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes — prevent refetch-induced flicker
  });

  // Resolve the image to display
  const resolvedImage = useMemo(() => {
    if (!imageList) return undefined; // still loading
    if (imageList.length === 0) return null; // no images → gradient

    if (backgroundImageId) {
      // Specific image requested
      const found = imageList.find((img) => img.id === backgroundImageId);
      return found ?? null; // not found → gradient
    }

    // Random pick — stable across re-renders thanks to randomSeed
    const index = Math.floor(randomSeed * imageList.length);
    return imageList[index];
  }, [imageList, backgroundImageId, randomSeed]);

  useEffect(() => {
    if (resolvedImage === undefined) return; // still loading
    if (resolvedImage === null) {
      setState({ mode: "gradient" });
      return;
    }

    // Use the presigned fullUrl directly — no proxy redirect needed
    const img = new Image();
    img.onload = () => setState({ mode: "image", url: img.src });
    img.onerror = () => {
      logger.error("Failed to load background image", { id: resolvedImage.id });
      setState({ mode: "gradient" });
    };
    img.src = resolvedImage.fullUrl;
  }, [resolvedImage]);

  return state;
}

const HeaderControls = () => (
  <div className="absolute top-4 end-4 md:top-6 md:end-6 z-40 flex items-center gap-2">
    <div className="bg-white/10 dark:bg-black/20 backdrop-blur-xs border border-white/20 dark:border-white/10 rounded-lg p-1">
      <LanguageSwitcher />
    </div>
    <div className="bg-white/10 dark:bg-black/20 backdrop-blur-xs border border-white/20 dark:border-white/10 rounded-lg p-1">
      <ModeToggle />
    </div>
  </div>
);

const BackgroundLayer = ({ background }: { background: BackgroundState }) => (
  <>
    <div className="absolute inset-0 z-0 bg-background" />
    {background.mode === "image" && (
      <div
        className="absolute inset-0 z-10"
        style={{
          backgroundImage: `url(${background.url})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      />
    )}
    {background.mode === "gradient" && (
      <div className="absolute inset-0 z-10" style={{ background: GRADIENT_FALLBACK }} />
    )}
    <div className="absolute inset-0 bg-black/40 z-20" />
  </>
);

export function WeTransferLayout({
  reverseShare,
  password,
  alias,
  isMaxFilesReached,
  hasUploadedSuccessfully,
  onUploadSuccess,
  isLinkInactive,
  isLinkNotFound,
  isLinkExpired,
}: WeTransferLayoutProps) {
  const background = useDynamicBackground(reverseShare?.backgroundImageId ?? null);
  const t = useTranslations();

  const getUploadSectionContent = () => {
    if (hasUploadedSuccessfully) {
      return (
        <WeTransferStatusMessage
          type={MESSAGE_TYPES.SUCCESS}
          icon={Check}
          titleKey="reverseShares.upload.success.title"
          descriptionKey="reverseShares.upload.success.description"
        />
      );
    }

    if (isLinkInactive) {
      return (
        <WeTransferStatusMessage
          type={MESSAGE_TYPES.INACTIVE}
          icon={TriangleAlert}
          titleKey="reverseShares.upload.linkInactive.title"
          descriptionKey="reverseShares.upload.linkInactive.description"
          showContactOwner
        />
      );
    }

    if (isLinkNotFound || !reverseShare) {
      return (
        <WeTransferStatusMessage
          type={MESSAGE_TYPES.NOT_FOUND}
          icon={TriangleAlert}
          titleKey="reverseShares.upload.linkNotFound.title"
          descriptionKey="reverseShares.upload.linkNotFound.description"
        />
      );
    }

    if (isLinkExpired) {
      return (
        <WeTransferStatusMessage
          type={MESSAGE_TYPES.EXPIRED}
          icon={Clock}
          titleKey="reverseShares.upload.linkExpired.title"
          descriptionKey="reverseShares.upload.linkExpired.description"
          showContactOwner
        />
      );
    }

    if (isMaxFilesReached) {
      return (
        <WeTransferStatusMessage
          type={MESSAGE_TYPES.MAX_FILES}
          icon={Info}
          titleKey="reverseShares.upload.maxFilesReached.title"
          descriptionKey="reverseShares.upload.maxFilesReached.description"
          showContactOwner
          reverseShare={reverseShare}
        />
      );
    }

    return (
      <FileUploadSection
        reverseShare={reverseShare}
        password={password}
        alias={alias}
        onUploadSuccess={onUploadSuccess}
      />
    );
  };

  return (
    <div className="min-h-screen relative overflow-hidden">
      <BackgroundLayer background={background} />
      <HeaderControls />

      {background.mode === "loading" && (
        <div className="absolute inset-0 z-30 flex items-center justify-center">
          <div className="animate-pulse text-white/70 text-sm">
            {t("reverseShares.upload.layout.loading")}
          </div>
        </div>
      )}

      <div className="relative z-30 min-h-screen flex items-center justify-start p-4 md:p-8 lg:p-12 xl:p-16">
        <div className="w-full max-w-md lg:max-w-lg xl:max-w-xl">
          <div className="bg-white dark:bg-black rounded-2xl shadow-2xl p-6 md:p-8 border border-white/20">
            <div className="text-start mb-6 md:mb-8">
              <h1 className="text-xl md:text-2xl lg:text-3xl font-bold text-foreground mb-2">
                {reverseShare?.name || t("reverseShares.upload.layout.defaultTitle")}
              </h1>
              {reverseShare?.description && (
                <p className="text-muted-foreground text-sm md:text-base">
                  {reverseShare.description}
                </p>
              )}
            </div>

            {getUploadSectionContent()}
          </div>
        </div>
      </div>

      <TransparentFooter />
    </div>
  );
}
