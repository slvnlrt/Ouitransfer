import { CloudUpload, FolderOpen } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { RecentFilesProps } from "../types";
import { DashboardFilesView } from "./dashboard-files-view";
import { EmptyFilesState } from "./empty-file-state";

export function RecentFiles({ files, fileManager, onOpenUploadModal }: RecentFilesProps) {
  const t = useTranslations();
  const router = useRouter();

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
          <CardTitle className="text-xl font-semibold flex items-center gap-2">
            <CloudUpload className="text-xl text-muted-foreground" />
            {t("recentFiles.title")}
          </CardTitle>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <Button
              className="font-semibold text-sm cursor-pointer"
              variant="outline"
              size="default"
              onClick={() => router.push("/files")}
            >
              <FolderOpen className="h-4 w-4" />
              {t("recentFiles.viewAll")}
            </Button>

            <Button
              className="font-semibold text-sm cursor-pointer"
              variant="outline"
              size="default"
              onClick={onOpenUploadModal}
            >
              <CloudUpload className="h-4 w-4" />
              {t("recentFiles.upload")}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {files.length > 0 ? (
          <DashboardFilesView
            files={files}
            onDelete={fileManager.setFileToDelete}
            onDownload={fileManager.handleDownload}
            onPreview={fileManager.setPreviewFile}
            onRename={fileManager.setFileToRename}
            onShare={fileManager.setFileToShare}
            onBulkDelete={fileManager.handleBulkDelete}
            onBulkShare={fileManager.handleBulkShare}
            onBulkDownload={fileManager.handleBulkDownload}
            setClearSelectionCallback={fileManager.setClearSelectionCallback}
            onUpdateName={(fileId, newName) => {
              const file = files.find((f) => f.id === fileId);
              if (file) {
                fileManager.handleRename(fileId, newName, file.description ?? undefined);
              }
            }}
            onUpdateDescription={(fileId, newDescription) => {
              const file = files.find((f) => f.id === fileId);
              if (file) {
                fileManager.handleRename(fileId, file.name, newDescription);
              }
            }}
          />
        ) : (
          <EmptyFilesState onUpload={onOpenUploadModal} />
        )}
      </CardContent>
    </Card>
  );
}
