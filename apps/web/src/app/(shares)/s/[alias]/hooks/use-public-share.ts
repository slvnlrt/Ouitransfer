"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { FileItem, FolderItem } from "@/components/tables/files-table-types";
import { getShareByAlias } from "@/http/endpoints/index";
import type { Share } from "@/http/endpoints/shares/types";
import { mapShareFiles, mapShareFolders } from "@/lib/api-mappers";
import { getCachedDownloadUrl } from "@/lib/download-url-cache";
import { logger } from "@/lib/logger";

const createSlug = (name: string): string => {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
};

const createFolderPathSlug = (allFolders: FolderItem[], folderId: string): string => {
  const path: string[] = [];
  let currentId: string | null = folderId;

  while (currentId) {
    const folder = allFolders.find((f) => f.id === currentId);
    if (folder) {
      const slug = createSlug(folder.name);
      path.unshift(slug || folder.id);
      currentId = folder.parentId ?? null;
    } else {
      break;
    }
  }

  return path.join("/");
};

const findFolderByPathSlug = (folders: FolderItem[], pathSlug: string): FolderItem | null => {
  const pathParts = pathSlug.split("/");
  let currentFolders = folders.filter((f) => !f.parentId);
  let currentFolder: FolderItem | null = null;

  for (const slugPart of pathParts) {
    currentFolder =
      currentFolders.find((folder) => {
        const slug = createSlug(folder.name);
        return slug === slugPart || folder.id === slugPart;
      }) ?? null;

    if (!currentFolder) return null;
    currentFolders = folders.filter((f) => f.parentId === currentFolder!.id);
  }

  return currentFolder;
};

interface ShareBrowseState {
  folders: FolderItem[];
  files: FileItem[];
  path: FolderItem[];
  isLoading: boolean;
  error: string | null;
}

export function usePublicShare() {
  const t = useTranslations();
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const alias = params?.alias as string;
  const [share, setShare] = useState<Share | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [password, setPassword] = useState("");
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [isPasswordError, setIsPasswordError] = useState(false);

  const [browseState, setBrowseState] = useState<ShareBrowseState>({
    folders: [],
    files: [],
    path: [],
    isLoading: true,
    error: null,
  });
  const urlFolderSlug = searchParams.get("folder") || null;
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const getFolderIdFromPathSlug = useCallback(
    (pathSlug: string | null, folders: FolderItem[]): string | null => {
      if (!pathSlug) return null;
      const folder = findFolderByPathSlug(folders, pathSlug);
      return folder ? folder.id : null;
    },
    [],
  );

  const getFolderPathSlugFromId = useCallback(
    (folderId: string | null, folders: FolderItem[]): string | null => {
      if (!folderId) return null;
      return createFolderPathSlug(folders, folderId);
    },
    [],
  );

  const loadShare = useCallback(
    async (sharePassword?: string) => {
      if (!alias) return;

      const handleShareError = (error: unknown) => {
        const axiosError = error as { response?: { data?: { error?: string } } };
        if (axiosError.response?.data?.error === "Password required") {
          setIsPasswordModalOpen(true);
          setShare(null);
        } else if (axiosError.response?.data?.error === "Invalid password") {
          setIsPasswordError(true);
          toast.error(t("share.errors.invalidPassword"));
        } else {
          toast.error(t("share.errors.loadFailed"));
        }
      };

      try {
        setIsLoading(true);
        const response = await getShareByAlias(
          alias,
          sharePassword ? { password: sharePassword } : undefined,
        );

        setShare(response.data.share);
        setIsPasswordModalOpen(false);
        setIsPasswordError(false);
      } catch (error: unknown) {
        handleShareError(error);
      } finally {
        setIsLoading(false);
      }
    },
    [alias, t],
  );

  const loadFolderContents = useCallback(
    (folderId: string | null) => {
      try {
        setBrowseState((prev) => ({ ...prev, isLoading: true, error: null }));

        if (!share) {
          setBrowseState((prev) => ({
            ...prev,
            isLoading: false,
            error: "No share data available",
          }));
          return;
        }

        const allFiles = mapShareFiles(share.files || []);
        const allFolders = mapShareFolders(share.folders || []);

        const shareFolderIds = new Set(allFolders.map((f) => f.id));

        const folders = allFolders.filter((folder) => {
          if (folderId === null) {
            return !folder.parentId || !shareFolderIds.has(folder.parentId);
          } else {
            return folder.parentId === folderId;
          }
        });
        const files = allFiles.filter((file) => (file.folderId || null) === folderId);

        const path: FolderItem[] = [];
        if (folderId) {
          let currentId: string | null = folderId;
          while (currentId) {
            const folder = allFolders.find((f) => f.id === currentId);
            if (folder) {
              path.unshift(folder);
              currentId = (folder.parentId as string | undefined) ?? null;
            } else {
              break;
            }
          }
        }

        setBrowseState({
          folders,
          files,
          path,
          isLoading: false,
          error: null,
        });
      } catch (error: unknown) {
        logger.error("Error loading folder contents", {
          err: error instanceof Error ? error.message : String(error),
        });
        setBrowseState((prev) => ({
          ...prev,
          isLoading: false,
          error: "Failed to load folder contents",
        }));
      }
    },
    [share],
  );

  const navigateToFolder = useCallback(
    (folderId?: string) => {
      const targetFolderId = folderId || null;
      setCurrentFolderId(targetFolderId);
      loadFolderContents(targetFolderId);

      const params = new URLSearchParams(searchParams);
      if (targetFolderId && share?.folders) {
        const folderPathSlug = getFolderPathSlugFromId(
          targetFolderId,
          mapShareFolders(share.folders || []),
        );
        if (folderPathSlug) {
          params.set("folder", folderPathSlug);
        } else {
          params.delete("folder");
        }
      } else {
        params.delete("folder");
      }
      router.push(`/s/${alias}?${params.toString()}`);
    },
    [loadFolderContents, searchParams, router, alias, share?.folders, getFolderPathSlugFromId],
  );

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  const handlePasswordSubmit = async () => {
    await loadShare(password);
  };

  const handleFolderDownload = async (folderId: string, folderName: string) => {
    try {
      if (!share) {
        throw new Error("Share data not available");
      }

      const shareFolderFiles = mapShareFiles(share.files || []);
      const shareFolderFolders = mapShareFolders(share.folders || []);

      // Get all files in this folder and subfolders with their paths
      const getFolderFilesWithPath = (
        targetFolderId: string,
        currentPath: string = "",
      ): Array<{ file: FileItem; path: string }> => {
        const filesWithPath: Array<{ file: FileItem; path: string }> = [];

        // Get direct files in this folder
        const directFiles = shareFolderFiles.filter((f) => f.folderId === targetFolderId);
        directFiles.forEach((file) => {
          filesWithPath.push({ file, path: currentPath });
        });

        // Get subfolders and process them recursively
        const subfolders = shareFolderFolders.filter((f) => f.parentId === targetFolderId);
        for (const subfolder of subfolders) {
          const subfolderPath = currentPath ? `${currentPath}/${subfolder.name}` : subfolder.name;
          filesWithPath.push(...getFolderFilesWithPath(subfolder.id, subfolderPath));
        }

        return filesWithPath;
      };

      const folderFilesWithPath = getFolderFilesWithPath(folderId);

      if (folderFilesWithPath.length === 0) {
        toast.error(t("shareManager.noFilesToDownload"));
        return;
      }

      const loadingToast = toast.loading(t("shareManager.creatingZip"));

      try {
        // Get presigned URLs for all files with their relative paths
        const downloadItems = await Promise.all(
          folderFilesWithPath.map(async ({ file, path }) => {
            const url = await getCachedDownloadUrl(
              file.objectName,
              password ? { headers: { "x-share-password": password } } : undefined,
            );
            return {
              url,
              name: path ? `${path}/${file.name}` : file.name,
            };
          }),
        );

        // Create ZIP with all files
        const { downloadFilesAsZip } = await import("@/utils/zip-download");
        const zipName = `${folderName}.zip`;
        await downloadFilesAsZip(downloadItems, zipName);

        toast.dismiss(loadingToast);
        toast.success(t("shareManager.zipDownloadSuccess"));
      } catch (error) {
        toast.dismiss(loadingToast);
        toast.error(t("shareManager.zipDownloadError"));
        throw error;
      }
    } catch (error) {
      logger.error("Error downloading folder", {
        err: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };

  const handleDownload = async (objectName: string, fileName: string) => {
    try {
      if (objectName.startsWith("folder:")) {
        const folderId = objectName.replace("folder:", "");
        await handleFolderDownload(folderId, fileName);
        return;
      }

      const loadingToast = toast.loading(t("share.messages.downloadStarted"));

      const url = await getCachedDownloadUrl(
        objectName,
        password ? { headers: { "x-share-password": password } } : undefined,
      );

      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      toast.dismiss(loadingToast);
      toast.success(t("shareManager.downloadSuccess"));
    } catch (error) {
      logger.error("Error downloading file", {
        err: error instanceof Error ? error.message : String(error),
      });
      toast.error(t("share.errors.downloadFailed"));
    }
  };

  const handleBulkDownload = async () => {
    const totalFiles = share?.files?.length || 0;
    const totalFolders = share?.folders?.length || 0;

    if (totalFiles === 0 && totalFolders === 0) {
      toast.error(t("shareManager.noFilesToDownload"));
      return;
    }

    if (!share) {
      toast.error(t("share.errors.loadFailed"));
      return;
    }

    try {
      const loadingToast = toast.loading(t("shareManager.creatingZip"));

      try {
        const bulkFiles = mapShareFiles(share.files || []);
        const bulkFolders = mapShareFolders(share.folders || []);

        // Helper function to get all files in a folder recursively with paths
        const getFolderFilesWithPath = (
          targetFolderId: string,
          currentPath: string = "",
        ): Array<{ file: FileItem; path: string }> => {
          const filesWithPath: Array<{ file: FileItem; path: string }> = [];

          // Get direct files in this folder
          const directFiles = bulkFiles.filter((f) => f.folderId === targetFolderId);
          directFiles.forEach((file) => {
            filesWithPath.push({ file, path: currentPath });
          });

          // Get subfolders and process them recursively
          const subfolders = bulkFolders.filter((f) => f.parentId === targetFolderId);
          for (const subfolder of subfolders) {
            const subfolderPath = currentPath ? `${currentPath}/${subfolder.name}` : subfolder.name;
            filesWithPath.push(...getFolderFilesWithPath(subfolder.id, subfolderPath));
          }

          return filesWithPath;
        };

        const allFilesToDownload: Array<{ url: string; name: string }> = [];

        // Get presigned URLs for root level files (not in any folder)
        const rootFiles = bulkFiles.filter((f) => !f.folderId);
        const rootFileItems = await Promise.all(
          rootFiles.map(async (file) => {
            const url = await getCachedDownloadUrl(
              file.objectName,
              password ? { headers: { "x-share-password": password } } : undefined,
            );
            return {
              url,
              name: file.name,
            };
          }),
        );
        allFilesToDownload.push(...rootFileItems);

        // Get presigned URLs for files in root level folders
        const rootFolders = bulkFolders.filter((f) => !f.parentId);
        for (const folder of rootFolders) {
          const folderFilesWithPath = getFolderFilesWithPath(folder.id, folder.name);

          const folderFileItems = await Promise.all(
            folderFilesWithPath.map(async ({ file, path }) => {
              const url = await getCachedDownloadUrl(
                file.objectName,
                password ? { headers: { "x-share-password": password } } : undefined,
              );
              return {
                url,
                name: path ? `${path}/${file.name}` : file.name,
              };
            }),
          );
          allFilesToDownload.push(...folderFileItems);
        }

        if (allFilesToDownload.length === 0) {
          toast.dismiss(loadingToast);
          toast.error(t("shareManager.noFilesToDownload"));
          return;
        }

        // Create ZIP with all files
        const { downloadFilesAsZip } = await import("@/utils/zip-download");
        const zipName = `${share.name || t("shareManager.defaultShareName")}.zip`;
        await downloadFilesAsZip(allFilesToDownload, zipName);

        toast.dismiss(loadingToast);
        toast.success(t("shareManager.zipDownloadSuccess"));
      } catch (error) {
        toast.dismiss(loadingToast);
        toast.error(t("shareManager.zipDownloadError"));
        throw error;
      }
    } catch (error) {
      logger.error("Error creating ZIP", {
        err: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const handleSelectedItemsBulkDownload = async (files: FileItem[], folders: FolderItem[]) => {
    if (files.length === 0 && folders.length === 0) {
      toast.error(t("shareManager.noFilesToDownload"));
      return;
    }

    if (!share) {
      toast.error(t("share.errors.loadFailed"));
      return;
    }

    try {
      const loadingToast = toast.loading(t("shareManager.creatingZip"));

      try {
        const selBulkFiles = mapShareFiles(share.files || []);
        const selBulkFolders = mapShareFolders(share.folders || []);

        // Helper function to get all files in a folder recursively with paths
        const getFolderFilesWithPath = (
          targetFolderId: string,
          currentPath: string = "",
        ): Array<{ file: FileItem; path: string }> => {
          const filesWithPath: Array<{ file: FileItem; path: string }> = [];

          // Get direct files in this folder
          const directFiles = selBulkFiles.filter((f) => f.folderId === targetFolderId);
          directFiles.forEach((file) => {
            filesWithPath.push({ file, path: currentPath });
          });

          // Get subfolders and process them recursively
          const subfolders = selBulkFolders.filter((f) => f.parentId === targetFolderId);
          for (const subfolder of subfolders) {
            const subfolderPath = currentPath ? `${currentPath}/${subfolder.name}` : subfolder.name;
            filesWithPath.push(...getFolderFilesWithPath(subfolder.id, subfolderPath));
          }

          return filesWithPath;
        };

        const allFilesToDownload: Array<{ url: string; name: string }> = [];

        // Get presigned URLs for direct files (not in folders)
        const directFileItems = await Promise.all(
          files.map(async (file) => {
            const url = await getCachedDownloadUrl(
              file.objectName,
              password ? { headers: { "x-share-password": password } } : undefined,
            );
            return {
              url,
              name: file.name,
            };
          }),
        );
        allFilesToDownload.push(...directFileItems);

        // Get presigned URLs for files in selected folders
        for (const folder of folders) {
          const folderFilesWithPath = getFolderFilesWithPath(folder.id, folder.name);

          const folderFileItems = await Promise.all(
            folderFilesWithPath.map(async ({ file, path }) => {
              const url = await getCachedDownloadUrl(
                file.objectName,
                password ? { headers: { "x-share-password": password } } : undefined,
              );
              return {
                url,
                name: path ? `${path}/${file.name}` : file.name,
              };
            }),
          );
          allFilesToDownload.push(...folderFileItems);
        }

        if (allFilesToDownload.length === 0) {
          toast.dismiss(loadingToast);
          toast.error(t("shareManager.noFilesToDownload"));
          return;
        }

        // Create ZIP with all files
        const { downloadFilesAsZip } = await import("@/utils/zip-download");
        const finalZipName = `${share.name || t("shareManager.defaultShareName")}-selected.zip`;
        await downloadFilesAsZip(allFilesToDownload, finalZipName);

        toast.dismiss(loadingToast);
        toast.success(t("shareManager.zipDownloadSuccess"));
      } catch (error) {
        toast.dismiss(loadingToast);
        toast.error(t("shareManager.zipDownloadError"));
        throw error;
      }
    } catch (error) {
      logger.error("Error creating ZIP", {
        err: error instanceof Error ? error.message : String(error),
      });
      toast.error(t("shareManager.zipDownloadError"));
    }
  };

  // Filter content based on search query
  const filteredFolders = browseState.folders.filter((folder) =>
    folder.name?.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const filteredFiles = browseState.files.filter((file) =>
    file.name?.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  useEffect(() => {
    if (alias) {
      loadShare();
    }
  }, [alias, loadShare]);

  useEffect(() => {
    if (share) {
      const resolvedFolderId = getFolderIdFromPathSlug(
        urlFolderSlug,
        mapShareFolders(share.folders || []),
      );
      setCurrentFolderId(resolvedFolderId);
      loadFolderContents(resolvedFolderId);
    }
  }, [share, loadFolderContents, urlFolderSlug, getFolderIdFromPathSlug]);

  return {
    // Original functionality
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

    // Browse functionality
    folders: filteredFolders,
    files: filteredFiles,
    path: browseState.path,
    isBrowseLoading: browseState.isLoading,
    browseError: browseState.error,
    currentFolderId,
    searchQuery,
    navigateToFolder,
    handleSearch,
    reload: () => loadFolderContents(currentFolderId),
  };
}
