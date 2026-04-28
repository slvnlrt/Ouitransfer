"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { useEnhancedFileManager } from "@/hooks/use-enhanced-file-manager";
import { listFiles } from "@/http/endpoints";
import { listFolders } from "@/http/endpoints/folders";

// These mirror the component-side File/Folder interfaces used throughout the files UI.
// Note: API returns description as string|null and size as string, but component types expect
// description as string|undefined and size as number. We use optional/union to bridge both.
interface FileBrowserFile {
  id: string;
  name: string;
  description?: string;
  extension: string;
  size: number;
  objectName: string;
  userId: string;
  folderId?: string;
  createdAt: string;
  updatedAt: string;
}

interface FileBrowserFolder {
  id: string;
  name: string;
  description?: string;
  objectName: string;
  parentId?: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  totalSize?: string;
  _count?: {
    files: number;
    children: number;
  };
}

const createSlug = (name: string): string => {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
};

const createFolderPathSlug = (allFolders: FileBrowserFolder[], folderId: string): string => {
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

const findFolderByPathSlug = (folders: FileBrowserFolder[], pathSlug: string): FileBrowserFolder | null => {
  const pathParts = pathSlug.split("/");
  let currentFolders = folders.filter((f) => !f.parentId);
  let currentFolder: FileBrowserFolder | null = null;

  for (const slugPart of pathParts) {
    currentFolder = currentFolders.find((folder) => {
      const slug = createSlug(folder.name);
      return slug === slugPart || folder.id === slugPart;
    }) ?? null;

    if (!currentFolder) return null;
    currentFolders = folders.filter((f) => f.parentId === currentFolder!.id);
  }

  return currentFolder;
};

export function useFileBrowser() {
  const t = useTranslations();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [files, setFiles] = useState<FileBrowserFile[]>([]);
  const [folders, setFolders] = useState<FileBrowserFolder[]>([]);
  const [allFiles, setAllFiles] = useState<FileBrowserFile[]>([]);
  const [allFolders, setAllFolders] = useState<FileBrowserFolder[]>([]);
  const [currentPath, setCurrentPath] = useState<FileBrowserFolder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [clearSelectionCallback, setClearSelectionCallbackState] = useState<(() => void) | undefined>();
  const [dataLoaded, setDataLoaded] = useState(false);
  const [forceUpdate] = useState(0);
  const isNavigatingRef = useRef(false);
  const loadFilesRef = useRef<(() => Promise<void>) | null>(null);

  const urlFolderSlug = searchParams.get("folder") || null;
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);

  const setClearSelectionCallback = useCallback((callback: () => void) => {
    setClearSelectionCallbackState(() => callback);
  }, []);

  const getFolderIdFromPathSlug = useCallback((pathSlug: string | null, folders: FileBrowserFolder[]): string | null => {
    if (!pathSlug) return null;
    const folder = findFolderByPathSlug(folders, pathSlug);
    return folder ? folder.id : null;
  }, []);

  const getFolderPathSlugFromId = useCallback((folderId: string | null, folders: FileBrowserFolder[]): string | null => {
    if (!folderId) return null;
    return createFolderPathSlug(folders, folderId);
  }, []);

  const buildBreadcrumbPath = useCallback((allFolders: FileBrowserFolder[], folderId: string): FileBrowserFolder[] => {
    const path: FileBrowserFolder[] = [];
    let currentId: string | null = folderId;

    while (currentId) {
      const folder = allFolders.find((f) => f.id === currentId);
      if (folder) {
        path.unshift(folder);
        currentId = folder.parentId ?? null;
      } else {
        break;
      }
    }

    return path;
  }, []);

  const buildFolderPath = useCallback((allFolders: FileBrowserFolder[], folderId: string | null): string => {
    if (!folderId) return "";

    const pathParts: string[] = [];
    let currentId: string | null = folderId;

    while (currentId) {
      const folder = allFolders.find((f) => f.id === currentId);
      if (folder) {
        pathParts.unshift(folder.name);
        currentId = folder.parentId ?? null;
      } else {
        break;
      }
    }

    return pathParts.join(" / ");
  }, []);

  const navigateToFolderDirect = useCallback(
    (targetFolderId: string | null) => {
      const currentFiles = allFiles.filter((file) => (file.folderId || null) === targetFolderId);
      const currentFolders = allFolders.filter((folder) => (folder.parentId || null) === targetFolderId);

      const sortedFiles = [...currentFiles].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      const sortedFolders = [...currentFolders].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      setFiles(sortedFiles);
      setFolders(sortedFolders);

      if (targetFolderId) {
        const path = buildBreadcrumbPath(allFolders, targetFolderId);
        setCurrentPath(path);
      } else {
        setCurrentPath([]);
      }

      const params = new URLSearchParams(searchParams);
      if (targetFolderId) {
        const folderPathSlug = getFolderPathSlugFromId(targetFolderId, allFolders);
        if (folderPathSlug) {
          params.set("folder", folderPathSlug);
        } else {
          params.delete("folder");
        }
      } else {
        params.delete("folder");
      }
      window.history.pushState({}, "", `/files?${params.toString()}`);
    },
    [allFiles, allFolders, buildBreadcrumbPath, searchParams, getFolderPathSlugFromId]
  );

  const navigateToFolder = useCallback(
    (folderId?: string) => {
      const targetFolderId = folderId || null;

      if (dataLoaded && allFiles.length > 0) {
        isNavigatingRef.current = true;
        navigateToFolderDirect(targetFolderId);
        // Refresh data when navigating to ensure we have latest state
        setTimeout(async () => {
          if (loadFilesRef.current) {
            await loadFilesRef.current();
          }
          isNavigatingRef.current = false;
        }, 0);
      } else {
        const params = new URLSearchParams(searchParams);
        if (folderId) {
          const folderPathSlug = getFolderPathSlugFromId(folderId, allFolders);
          if (folderPathSlug) {
            params.set("folder", folderPathSlug);
          } else {
            params.delete("folder");
          }
        } else {
          params.delete("folder");
        }
        router.push(`/files?${params.toString()}`);
      }
    },
    [dataLoaded, allFiles.length, navigateToFolderDirect, searchParams, router, getFolderPathSlugFromId, allFolders]
  );

  const navigateToRoot = useCallback(() => {
    navigateToFolder();
  }, [navigateToFolder]);

  const loadFiles = useCallback(async () => {
    try {
      setIsLoading(true);

      const [filesResponse, foldersResponse] = await Promise.all([listFiles(), listFolders()]);

      // Cast API types to view-model types (API uses string|null; components expect undefined)
      const fetchedFiles = (filesResponse.data.files || []) as unknown as FileBrowserFile[];
      const fetchedFolders = (foldersResponse.data.folders || []) as unknown as FileBrowserFolder[];

      setAllFiles(fetchedFiles);
      setAllFolders(fetchedFolders);
      setDataLoaded(true);

      const resolvedFolderId = getFolderIdFromPathSlug(urlFolderSlug, fetchedFolders);
      setCurrentFolderId(resolvedFolderId);

      const currentFiles = fetchedFiles.filter((file) => (file.folderId || null) === resolvedFolderId);
      const currentFolders = fetchedFolders.filter((folder) => (folder.parentId || null) === resolvedFolderId);

      const sortedFiles = [...currentFiles].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      const sortedFolders = [...currentFolders].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      setFiles(sortedFiles);
      setFolders(sortedFolders);

      if (resolvedFolderId) {
        const path = buildBreadcrumbPath(fetchedFolders, resolvedFolderId);
        setCurrentPath(path);
      } else {
        setCurrentPath([]);
      }
    } catch {
      toast.error(t("files.loadError"));
    } finally {
      setIsLoading(false);
    }
  }, [urlFolderSlug, buildBreadcrumbPath, t, getFolderIdFromPathSlug]);

  const handleImmediateUpdate = useCallback(
    (itemId: string, itemType: "file" | "folder", newParentId: string | null | "__DELETE__") => {
      // Use requestAnimationFrame for smoother updates
      requestAnimationFrame(() => {
        // Check if this is a delete operation
        if (newParentId === "__DELETE__") {
          // Remove the item from all state collections
          if (itemType === "file") {
            setFiles((prevFiles) => prevFiles.filter((file) => file.id !== itemId));
            setAllFiles((prevAllFiles) => prevAllFiles.filter((file) => file.id !== itemId));
          } else if (itemType === "folder") {
            setFolders((prevFolders) => prevFolders.filter((folder) => folder.id !== itemId));
            setAllFolders((prevAllFolders) => prevAllFolders.filter((folder) => folder.id !== itemId));
          }
        } else {
          // Move operation: newParentId is string | null here (TypeScript narrows correctly)
          if (itemType === "file") {
            setFiles((prevFiles) => prevFiles.filter((file) => file.id !== itemId));
            setAllFiles((prevAllFiles) =>
              prevAllFiles.map((file) => (file.id === itemId ? { ...file, folderId: newParentId ?? undefined } : file))
            );
          } else if (itemType === "folder") {
            setFolders((prevFolders) => prevFolders.filter((folder) => folder.id !== itemId));
            setAllFolders((prevAllFolders) =>
              prevAllFolders.map((folder) => (folder.id === itemId ? { ...folder, parentId: newParentId ?? undefined } : folder))
            );
          }
        }
      });
    },
    []
  );

  const fileManager = useEnhancedFileManager(
    loadFiles,
    clearSelectionCallback,
    handleImmediateUpdate,
    allFiles,
    allFolders
  );

  const getImmediateChildFoldersWithMatches = useCallback(() => {
    if (!searchQuery) return [];

    const matchingItems = new Set<string>();

    allFiles
      .filter((file) => file.name.toLowerCase().includes(searchQuery.toLowerCase()))
      .forEach((file) => {
        if (file.folderId) {
          let currentId: string | null = file.folderId;
          while (currentId) {
            const folder = allFolders.find((f) => f.id === currentId);
            if (folder) {
              if ((folder.parentId || null) === currentFolderId) {
                matchingItems.add(folder.id);
                break;
              }
              currentId = folder.parentId ?? null;
            } else {
              break;
            }
          }
        }
      });

    allFolders
      .filter((folder) => folder.name.toLowerCase().includes(searchQuery.toLowerCase()))
      .forEach((folder) => {
        let currentId: string | null = folder.id;
        while (currentId) {
          const folderInPath = allFolders.find((f) => f.id === currentId);
          if (folderInPath) {
            if ((folderInPath.parentId || null) === currentFolderId) {
              matchingItems.add(folderInPath.id);
              break;
            }
            currentId = folderInPath.parentId ?? null;
          } else {
            break;
          }
        }
      });

    return allFolders
      .filter((folder) => matchingItems.has(folder.id))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [searchQuery, allFiles, allFolders, currentFolderId]);

  const filteredFiles = searchQuery
    ? allFiles
        .filter(
          (file) =>
            file.name.toLowerCase().includes(searchQuery.toLowerCase()) && (file.folderId || null) === currentFolderId
        )
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    : files;

  const filteredFolders = searchQuery ? getImmediateChildFoldersWithMatches() : folders;

  // Update loadFilesRef whenever loadFiles changes
  useEffect(() => {
    loadFilesRef.current = loadFiles;
  }, [loadFiles]);

  // Load files only on mount or when explicitly called
  useEffect(() => {
    loadFilesRef.current?.();
  }, []); // Empty dependency array - load only on mount

  return {
    isLoading,
    files,
    folders,
    currentPath,
    currentFolderId,
    searchQuery,

    navigateToFolder,
    navigateToRoot,

    modals: {
      isUploadModalOpen,
      onOpenUploadModal: () => setIsUploadModalOpen(true),
      onCloseUploadModal: () => setIsUploadModalOpen(false),
    },

    fileManager: {
      ...fileManager,
      setClearSelectionCallback,
    } as typeof fileManager & { setClearSelectionCallback: typeof setClearSelectionCallback },

    filteredFiles,
    filteredFolders,

    handleSearch: setSearchQuery,
    loadFiles,
    handleImmediateUpdate,
    forceUpdate,

    allFiles,
    allFolders,
    buildFolderPath,
  };
}

export const useFiles = useFileBrowser;
