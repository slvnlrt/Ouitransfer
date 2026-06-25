"use client";

import { ProtectedRoute } from "@/components/auth/protected-route";
import { LoadingScreen } from "@/components/layout/loading-screen";
import { PageLayout } from "@/components/layout/page-layout";
import { Card, CardContent } from "@/components/ui/card";
import { ReverseSharesCardsContainer } from "./components/reverse-shares-cards-container";
import { ReverseSharesHeader } from "./components/reverse-shares-header";
import { ReverseSharesModals } from "./components/reverse-shares-modals";
import { ReverseSharesSearch } from "./components/reverse-shares-search";
import { useReverseShares } from "./hooks/use-reverse-shares";

export default function ReverseSharesPage() {
  const {
    reverseShares,
    isLoading,
    searchQuery,
    setSearchQuery,
    filteredReverseShares,
    reverseShareToViewDetails,
    reverseShareToGenerateLink,
    reverseShareToDelete,
    reverseShareToViewFiles,
    reverseShareToViewQrCode,
    isDeleting,
    isCreateModalOpen,
    isCreating,
    setIsCreateModalOpen,
    handleCopyLink,
    handleDeleteReverseShare,
    handleCreateReverseShare,
    setReverseShareToViewDetails,
    setReverseShareToGenerateLink,
    setReverseShareToDelete,
    setReverseShareToViewFiles,
    setReverseShareToViewQrCode,
    handleCreateAlias,
    handleUpdatePassword,
    handleUpdateReverseShareData,
    handleToggleActive,
    loadReverseShares,
    refreshReverseShare,
  } = useReverseShares();

  if (isLoading) {
    return <LoadingScreen />;
  }

  return (
    <ProtectedRoute>
      <PageLayout>
        <div className="flex flex-col gap-8">
          <ReverseSharesHeader />
          <Card>
            <CardContent>
              <div className="flex flex-col gap-6">
                <ReverseSharesSearch
                  filteredCount={filteredReverseShares.length}
                  searchQuery={searchQuery}
                  totalReverseShares={reverseShares.length}
                  onCreateReverseShare={() => setIsCreateModalOpen(true)}
                  onSearchChange={setSearchQuery}
                  onRefresh={loadReverseShares}
                  isRefreshing={isLoading}
                />

                <ReverseSharesCardsContainer
                  reverseShares={filteredReverseShares}
                  onCopyLink={handleCopyLink}
                  onDelete={setReverseShareToDelete}
                  onGenerateLink={setReverseShareToGenerateLink}
                  onViewDetails={setReverseShareToViewDetails}
                  onViewFiles={setReverseShareToViewFiles}
                  onViewQrCode={setReverseShareToViewQrCode}
                  onCreateReverseShare={() => setIsCreateModalOpen(true)}
                  onUpdateReverseShare={handleUpdateReverseShareData}
                  onToggleActive={handleToggleActive}
                  onUpdatePassword={handleUpdatePassword}
                />
              </div>
            </CardContent>
          </Card>

          <ReverseSharesModals
            isCreateModalOpen={isCreateModalOpen}
            onCloseCreateModal={() => setIsCreateModalOpen(false)}
            onCreateReverseShare={handleCreateReverseShare}
            isCreating={isCreating}
            reverseShareToGenerateLink={reverseShareToGenerateLink}
            reverseShareToViewDetails={reverseShareToViewDetails}
            reverseShareToDelete={reverseShareToDelete}
            reverseShareToViewFiles={reverseShareToViewFiles}
            reverseShareToViewQrCode={reverseShareToViewQrCode}
            isDeleting={isDeleting}
            onCloseGenerateLink={() => setReverseShareToGenerateLink(null)}
            onCloseViewDetails={() => setReverseShareToViewDetails(null)}
            onCloseDeleteModal={() => setReverseShareToDelete(null)}
            onCloseViewFiles={() => setReverseShareToViewFiles(null)}
            onCloseViewQrCode={() => setReverseShareToViewQrCode(null)}
            onConfirmDelete={handleDeleteReverseShare}
            onCreateAlias={handleCreateAlias}
            onCopyLink={handleCopyLink}
            onViewQrCode={setReverseShareToViewQrCode}
            onUpdateReverseShareData={handleUpdateReverseShareData}
            onUpdatePassword={handleUpdatePassword}
            onToggleActive={handleToggleActive}
            onRefreshData={loadReverseShares}
            refreshReverseShare={refreshReverseShare}
          />
        </div>
      </PageLayout>
    </ProtectedRoute>
  );
}
