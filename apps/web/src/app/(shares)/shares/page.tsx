"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { LoadingScreen } from "@/components/layout/loading-screen";
import { PageLayout } from "@/components/layout/page-layout";
import { Card, CardContent } from "@/components/ui/card";
import { useDisclosure } from "@/hooks/use-disclosure";
import { useEnhancedFileManager } from "@/hooks/use-enhanced-file-manager";
import { useShareManager } from "@/hooks/use-share-manager";
import { SharesHeader } from "./components/shares-header";
import { SharesModals } from "./components/shares-modals";
import { SharesSearch } from "./components/shares-search";
import { SharesTableContainer } from "./components/shares-table-container";
import { useShares } from "./hooks/use-shares";

export default function SharesPage() {
  const searchParams = useSearchParams();
  const openShareId = searchParams.get("open");

  const {
    shares,
    isLoading,
    searchQuery,
    setSearchQuery,
    filteredShares,
    handleCopyLink,
    loadShares,
    smtpEnabled,
  } = useShares();

  const {
    isOpen: isCreateModalOpen,
    onOpen: onOpenCreateModal,
    onClose: onCloseCreateModal,
  } = useDisclosure();
  const shareManager = useShareManager(loadShares);
  const fileManager = useEnhancedFileManager(loadShares);

  // Auto-open the share details modal when ?open=<shareId> is present
  const hasAutoOpened = useRef(false);
  useEffect(() => {
    if (!openShareId || isLoading || hasAutoOpened.current) return;
    const matchingShare = shares.find((s) => s.id === openShareId);
    if (matchingShare) {
      shareManager.setShareToViewDetails(matchingShare);
      hasAutoOpened.current = true;
    }
  }, [openShareId, shares, isLoading, shareManager]);

  if (isLoading) {
    return <LoadingScreen />;
  }

  return (
    <ProtectedRoute>
      <PageLayout>
        <div className="flex flex-col gap-8">
          <SharesHeader />
          <Card>
            <CardContent>
              <div className="flex flex-col gap-6">
                <SharesSearch
                  filteredCount={filteredShares.length}
                  searchQuery={searchQuery}
                  totalShares={shares.length}
                  onCreateShare={onOpenCreateModal}
                  onSearchChange={setSearchQuery}
                />

                <SharesTableContainer
                  shareManager={shareManager}
                  shares={filteredShares}
                  onCopyLink={handleCopyLink}
                  onCreateShare={onOpenCreateModal}
                />
              </div>
            </CardContent>
          </Card>

          <SharesModals
            isCreateModalOpen={isCreateModalOpen}
            shareManager={shareManager}
            fileManager={fileManager}
            shareToGenerateLink={shareManager.shareToGenerateLink}
            shareToViewDetails={shareManager.shareToViewDetails}
            smtpEnabled={smtpEnabled}
            onCloseCreateModal={onCloseCreateModal}
            onCloseGenerateLink={() => shareManager.setShareToGenerateLink(null)}
            onCloseViewDetails={() => shareManager.setShareToViewDetails(null)}
            onSuccess={loadShares}
          />
        </div>
      </PageLayout>
    </ProtectedRoute>
  );
}
