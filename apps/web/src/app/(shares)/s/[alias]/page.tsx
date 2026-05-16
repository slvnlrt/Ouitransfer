"use client";

import { Lock } from "lucide-react";
import { useTranslations } from "next-intl";

import { ErrorDisplay } from "@/components/error-display";
import { LoadingScreen } from "@/components/layout/loading-screen";
import { DefaultFooter } from "@/components/ui/default-footer";
import { PasswordModal } from "./components/password-modal";
import { ShareDetails } from "./components/share-details";
import { ShareHeader } from "./components/share-header";
import { usePublicShare } from "./hooks/use-public-share";

export default function PublicSharePage() {
  const t = useTranslations();
  const {
    isLoading,
    share,
    password,
    isPasswordModalOpen,
    isPasswordError,
    setPassword,
    handlePasswordSubmit,
    handleDownload,
    handleBulkDownload,
    handleSelectedItemsBulkDownload,
    folders,
    files,
    path,
    isBrowseLoading,
    searchQuery,
    navigateToFolder,
    handleSearch,
  } = usePublicShare();

  if (isLoading) {
    return <LoadingScreen />;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <ShareHeader />

      <div className="flex-1 container mx-auto px-6 py-8">
        <div className="max-w-5xl mx-auto space-y-6">
          {!isPasswordModalOpen && !share && (
            <ErrorDisplay
              variant="page"
              title={t("share.notFound.title")}
              message={t("share.notFound.description")}
              icon={
                <div className="w-20 h-20 rounded-full bg-destructive/20 flex items-center justify-center">
                  <Lock className="w-10 h-10 text-destructive" />
                </div>
              }
            />
          )}
          {share && (
            <ShareDetails
              share={share}
              password={password}
              onDownload={handleDownload}
              onBulkDownload={handleBulkDownload}
              onSelectedItemsBulkDownload={handleSelectedItemsBulkDownload}
              folders={folders}
              files={files}
              path={path}
              isBrowseLoading={isBrowseLoading}
              searchQuery={searchQuery}
              navigateToFolder={navigateToFolder}
              handleSearch={handleSearch}
            />
          )}
        </div>
      </div>

      <DefaultFooter />

      <PasswordModal
        isError={isPasswordError}
        isOpen={isPasswordModalOpen}
        password={password}
        onPasswordChange={setPassword}
        onSubmit={handlePasswordSubmit}
      />
    </div>
  );
}
