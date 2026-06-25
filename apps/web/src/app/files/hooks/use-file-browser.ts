"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { FileItem, FolderItem } from "@/components/tables/files-table-types";
import { useEnhancedFileManager } from "@/hooks/use-enhanced-file-manager";
import { listFiles } from "@/http/endpoints";
import { listFolders } from "@/http/endpoints/folders";
import { mapApiFiles, mapApiFolders } from "@/lib/api-mappers";
import { queryKeys } from "@/lib/query-keys";

// ---------------------------------------------------------------------------
// Pure utilities (no hooks / no state)
// ---------------------------------------------------------------------------

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

/** Resolve a URL path-slug to a folder ID. */
const getFolderIdFromPathSlug = (pathSlug: string | null, folders: FolderItem[]): string | null => {
  if (!pathSlug) return null;
  const folder = findFolderByPathSlug(folders, pathSlug);
  return folder ? folder.id : null;
};

/** Build breadcrumb path by walking parent chain. */
const buildBreadcrumbPath = (allFolders: FolderItem[], folderId: string): FolderItem[] => {
  const path: FolderItem[] = [];
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
};

/** Build human-readable folder path string. */
const buildFolderPath = (allFolders: FolderItem[], folderId: string | null): string => {
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
};

/** Sort items by createdAt descending (newest first). */
const sortByCreatedAtDesc = <T extends { createdAt: string }>(items: T[]): T[] =>
  [...items].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

// ---------------------------------------------------------------------------
// Query data type
// ---------------------------------------------------------------------------

interface FileBrowserData {
  files: FileItem[];
  folders: FolderItem[];
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useFileBrowser() {
  const t = useTranslations();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  // ── Kept state ───────────────────────────────────────────────────────
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [clearSelectionCallback, setClearSelectionCallbackState] = useState<
    (() => void) | undefined
  >();

  /**
   * Track programmatic navigations (user clicked folder in UI) so that the
   * URL→state sync effect can skip re-resolving when the change was initiated
   * by our own code rather than the browser's back/forward buttons.
   */
  const isNavigatingRef = useRef(false);

  const urlFolderSlug = searchParams.get("folder") || null;

  const setClearSelectionCallback = useCallback((callback: () => void) => {
    setClearSelectionCallbackState(() => callback);
  }, []);

  // ── TanStack Query: fetch ALL files + folders ────────────────────────
  const allDataQuery = useQuery({
    queryKey: queryKeys.fileBrowser.data(),
    queryFn: async () => {
      const [filesRes, foldersRes] = await Promise.all([listFiles(), listFolders()]);
      return {
        files: mapApiFiles(filesRes.data.files || []),
        folders: mapApiFolders(foldersRes.data.folders || []),
      } satisfies FileBrowserData;
    },
  });

  const allFiles = allDataQuery.data?.files ?? [];
  const allFolders = allDataQuery.data?.folders ?? [];
  const isLoading = allDataQuery.isLoading;
  const dataLoaded = allDataQuery.isSuccess;

  // ── URL → currentFolderId sync ───────────────────────────────────────
  // Whenever the URL slug changes (initial load, back/forward, etc.) and
  // data is available, resolve the slug to a folder ID. Skip if the change
  // was programmatic (navigateToFolder already set currentFolderId).
  useEffect(() => {
    if (!dataLoaded) return;

    // Programmatic navigation — navigateToFolder already set state and pushed
    // the URL. Reset the flag and skip re-resolving.
    if (isNavigatingRef.current) {
      isNavigatingRef.current = false;
      return;
    }

    const resolved = getFolderIdFromPathSlug(urlFolderSlug, allFolders);
    setCurrentFolderId((prev) => (prev === resolved ? prev : resolved));
  }, [urlFolderSlug, dataLoaded, allFolders]);

  // ── Derived: current folder contents (filtered from cache) ───────────
  const files = useMemo(
    () => sortByCreatedAtDesc(allFiles.filter((f) => (f.folderId || null) === currentFolderId)),
    [allFiles, currentFolderId],
  );

  const folders = useMemo(
    () => sortByCreatedAtDesc(allFolders.filter((f) => (f.parentId || null) === currentFolderId)),
    [allFolders, currentFolderId],
  );

  // ── Derived: breadcrumb path ─────────────────────────────────────────
  const currentPath = useMemo(
    () => (currentFolderId ? buildBreadcrumbPath(allFolders, currentFolderId) : []),
    [allFolders, currentFolderId],
  );

  // ── Navigation ───────────────────────────────────────────────────────

  const getFolderPathSlugFromId = useCallback(
    (folderId: string | null, foldersArr: FolderItem[]): string | null => {
      if (!folderId) return null;
      return createFolderPathSlug(foldersArr, folderId);
    },
    [],
  );

  const navigateToFolderDirect = useCallback(
    (targetFolderId: string | null) => {
      setCurrentFolderId(targetFolderId);

      // Build URL with updated folder param
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

      // Use Next.js router so useSearchParams stays in sync and
      // browser back/forward triggers proper re-renders.
      const paramStr = params.toString();
      const url = paramStr ? `/files?${paramStr}` : "/files";
      router.push(url, { scroll: false });
    },
    [allFolders, searchParams, getFolderPathSlugFromId, router],
  );

  const navigateToFolder = useCallback(
    (folderId?: string) => {
      const targetFolderId = folderId || null;

      if (dataLoaded) {
        // Mark as programmatic so the URL→state sync effect skips re-resolving.
        // The effect itself resets the flag.
        isNavigatingRef.current = true;
        navigateToFolderDirect(targetFolderId);
      } else {
        // Data not loaded yet — do a full route push so URL changes and
        // the query will sync on the next render
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
    [dataLoaded, navigateToFolderDirect, searchParams, router, getFolderPathSlugFromId, allFolders],
  );

  const navigateToRoot = useCallback(() => {
    navigateToFolder();
  }, [navigateToFolder]);

  // ── loadFiles: now wraps query invalidation ──────────────────────────
  const loadFiles = useCallback(async () => {
    try {
      await queryClient.invalidateQueries({ queryKey: queryKeys.fileBrowser.data() });
    } catch {
      toast.error(t("files.loadError"));
    }
  }, [queryClient, t]);

  // ── Optimistic updates via setQueryData ──────────────────────────────
  const handleImmediateUpdate = useCallback(
    (itemId: string, itemType: "file" | "folder", newParentId: string | null | "__DELETE__") => {
      requestAnimationFrame(() => {
        queryClient.setQueryData<FileBrowserData>(queryKeys.fileBrowser.data(), (old) => {
          if (!old) return old;

          if (newParentId === "__DELETE__") {
            // Delete operation
            return {
              files: itemType === "file" ? old.files.filter((f) => f.id !== itemId) : old.files,
              folders:
                itemType === "folder" ? old.folders.filter((f) => f.id !== itemId) : old.folders,
            };
          }

          // Move operation
          if (itemType === "file") {
            return {
              files: old.files.map((f) =>
                f.id === itemId ? { ...f, folderId: newParentId ?? undefined } : f,
              ),
              folders: old.folders,
            };
          }
          // itemType === "folder"
          return {
            files: old.files,
            folders: old.folders.map((f) =>
              f.id === itemId ? { ...f, parentId: newParentId ?? undefined } : f,
            ),
          };
        });
      });
    },
    [queryClient],
  );

  // ── Enhanced file manager ────────────────────────────────────────────
  const fileManager = useEnhancedFileManager(
    loadFiles,
    clearSelectionCallback,
    handleImmediateUpdate,
    allFiles,
    allFolders,
  );

  // ── Search filtering ─────────────────────────────────────────────────

  const getImmediateChildFoldersWithMatches = useCallback(() => {
    if (!searchQuery) return [];

    const matchingItems = new Set<string>();

    allFiles
      .filter((file) => file.name.toLowerCase().includes(searchQuery.toLowerCase()))
      .forEach((file) => {
        if (file.folderId) {
          let curId: string | null = file.folderId;
          while (curId) {
            const folder = allFolders.find((f) => f.id === curId);
            if (folder) {
              if ((folder.parentId || null) === currentFolderId) {
                matchingItems.add(folder.id);
                break;
              }
              curId = folder.parentId ?? null;
            } else {
              break;
            }
          }
        }
      });

    allFolders
      .filter((folder) => folder.name.toLowerCase().includes(searchQuery.toLowerCase()))
      .forEach((folder) => {
        let curId: string | null = folder.id;
        while (curId) {
          const folderInPath = allFolders.find((f) => f.id === curId);
          if (folderInPath) {
            if ((folderInPath.parentId || null) === currentFolderId) {
              matchingItems.add(folderInPath.id);
              break;
            }
            curId = folderInPath.parentId ?? null;
          } else {
            break;
          }
        }
      });

    return sortByCreatedAtDesc(allFolders.filter((folder) => matchingItems.has(folder.id)));
  }, [searchQuery, allFiles, allFolders, currentFolderId]);

  const filteredFiles = searchQuery
    ? sortByCreatedAtDesc(
        allFiles.filter(
          (file) =>
            file.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
            (file.folderId || null) === currentFolderId,
        ),
      )
    : files;

  const filteredFolders = searchQuery ? getImmediateChildFoldersWithMatches() : folders;

  // ── Return (interface identical to the pre-migration version) ────────
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
    forceUpdate: 0,

    allFiles,
    allFolders,
    buildFolderPath,
  };
}
