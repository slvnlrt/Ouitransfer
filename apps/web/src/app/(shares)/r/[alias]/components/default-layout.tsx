"use client";

import { Check, Clock, Info, TriangleAlert } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { LanguageSwitcher } from "@/components/general/language-switcher";
import { ModeToggle } from "@/components/general/mode-toggle";
import { DefaultFooter } from "@/components/ui/default-footer";
import { useAppInfo } from "@/contexts/app-info-context";
import type { DefaultLayoutProps } from "../types";
import { FileUploadSection } from "./file-upload-section";
import { StatusMessage } from "./shared/status-message";

export function DefaultLayout({
  reverseShare,
  password,
  alias,
  isMaxFilesReached,
  hasUploadedSuccessfully,
  onUploadSuccess,
  isLinkInactive,
  isLinkNotFound,
  isLinkExpired,
}: DefaultLayoutProps) {
  const { appName, appLogo } = useAppInfo();
  const t = useTranslations();

  const getUploadStatus = () => {
    if (hasUploadedSuccessfully) {
      return {
        component: (
          <StatusMessage
            icon={Check}
            title={t("reverseShares.upload.success.title")}
            description={t("reverseShares.upload.success.description")}
            variant="success"
          />
        ),
      };
    }

    if (isLinkInactive) {
      return {
        component: (
          <StatusMessage
            icon={TriangleAlert}
            title={t("reverseShares.upload.linkInactive.title")}
            description={t("reverseShares.upload.linkInactive.description")}
            additionalText={t("reverseShares.upload.linkInactive.contactOwner")}
            variant="error"
          />
        ),
      };
    }

    if (isLinkNotFound || !reverseShare) {
      return {
        component: (
          <StatusMessage
            icon={TriangleAlert}
            title={t("reverseShares.upload.linkNotFound.title")}
            description={t("reverseShares.upload.linkNotFound.description")}
            variant="neutral"
          />
        ),
      };
    }

    if (isLinkExpired) {
      return {
        component: (
          <StatusMessage
            icon={Clock}
            title={t("reverseShares.upload.linkExpired.title")}
            description={t("reverseShares.upload.linkExpired.description")}
            additionalText={t("reverseShares.upload.linkExpired.contactOwner")}
            variant="info"
          />
        ),
      };
    }

    if (isMaxFilesReached) {
      return {
        component: (
          <StatusMessage
            icon={Info}
            title={t("reverseShares.upload.maxFilesReached.title")}
            description={t("reverseShares.upload.maxFilesReached.description", {
              maxFiles: reverseShare?.maxFiles || 0,
            })}
            additionalText={t("reverseShares.upload.maxFilesReached.contactOwner")}
            variant="warning"
          />
        ),
      };
    }

    return {
      component: (
        <FileUploadSection
          reverseShare={reverseShare}
          password={password}
          alias={alias}
          onUploadSuccess={onUploadSuccess}
        />
      ),
    };
  };

  const showUploadLimits =
    !hasUploadedSuccessfully &&
    !isMaxFilesReached &&
    !isLinkInactive &&
    !isLinkNotFound &&
    !isLinkExpired &&
    reverseShare &&
    (reverseShare.maxFiles || reverseShare.maxFileSize || reverseShare.allowedFileTypes);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Public header */}
      <header className="w-full px-6 border-b border-border/60 bg-background shadow-sm">
        <div className="mx-auto max-w-5xl sm:p-0 h-16 flex items-center justify-between">
          <Link className="flex items-center gap-2" href="/">
            {appLogo && (
              <Image
                alt="App Logo"
                className="object-contain rounded"
                src={appLogo}
                width={32}
                height={32}
                unoptimized
              />
            )}
            <p className="font-bold text-2xl text-foreground">{appName}</p>
          </Link>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <ModeToggle />
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 container mx-auto px-6 py-8 md:py-12">
        <div className="max-w-2xl mx-auto space-y-8 ">
          {/* Page header */}
          <div className="text-center space-y-4">
            <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold text-foreground">
              {reverseShare?.name || t("reverseShares.upload.layout.defaultTitle")}
            </h1>
            {reverseShare?.description && (
              <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
                {reverseShare.description}
              </p>
            )}
          </div>

          {/* Upload section */}
          <div className="bg-card rounded-xl shadow-sm border border-border p-6 md:p-8 lg:p-10">
            {getUploadStatus().component}
          </div>

          {/* Additional information */}
          {showUploadLimits && (
            <div className="bg-muted/30 rounded-lg p-4 space-y-2">
              <h3 className="text-sm font-medium text-foreground">
                {t("reverseShares.upload.layout.importantInfo")}
              </h3>
              <div className="text-xs text-muted-foreground space-y-1">
                {reverseShare?.maxFiles && (
                  <p>
                    • {t("reverseShares.upload.layout.maxFiles", { count: reverseShare.maxFiles })}
                  </p>
                )}
                {reverseShare?.maxFileSize && (
                  <p>
                    •{" "}
                    {t("reverseShares.upload.layout.maxFileSize", {
                      size: reverseShare.maxFileSize,
                    })}
                  </p>
                )}
                {reverseShare?.allowedFileTypes && (
                  <p>
                    •{" "}
                    {t("reverseShares.upload.layout.allowedTypes", {
                      types: reverseShare.allowedFileTypes,
                    })}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <DefaultFooter />
    </div>
  );
}
