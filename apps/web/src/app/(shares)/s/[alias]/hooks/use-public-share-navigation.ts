"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { FileItem, FolderItem } from "@/components/tables/files-table-types";
import type { Share } from "@/http/endpoints/shares/types";
import { mapShareFiles, mapShareFolders } from "@/lib/api-mappers";

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

export interface PublicShareNavigationHook {
  folders: FolderItem[];
  files: FileItem[];
  path: FolderItem[];
  isBrowseLoading: boolean;
  browseError: string | null;
  currentFolderId: string | null;
  searchQuery: string;
  navigateToFolder: (folderId?: string) => void;
  handleSearch: (query: string) => void;
}

export function usePublicShareNavigation(
  share: Share | null,
  isShareLoading: boolean,
): PublicShareNavigationHook {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const alias = params?.alias as string;

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

  // --- Derived browse state (pure computation from share data + currentFolderId) ---
  const browseState = useMemo((): ShareBrowseState => {
    if (!share) {
      return { folders: [], files: [], path: [], isLoading: isShareLoading, error: null };
    }

    const allFiles = mapShareFiles(share.files || []);
    const allFolders = mapShareFolders(share.folders || []);
    const shareFolderIds = new Set(allFolders.map((f) => f.id));

    const folders = allFolders.filter((folder) => {
      if (currentFolderId === null) {
        return !folder.parentId || !shareFolderIds.has(folder.parentId);
      }
      return folder.parentId === currentFolderId;
    });
    const files = allFiles.filter((file) => (file.folderId || null) === currentFolderId);

    const path: FolderItem[] = [];
    if (currentFolderId) {
      let currentId: string | null = currentFolderId;
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

    return { folders, files, path, isLoading: false, error: null };
  }, [share, currentFolderId, isShareLoading]);

  const navigateToFolder = useCallback(
    (folderId?: string) => {
      const targetFolderId = folderId || null;
      setCurrentFolderId(targetFolderId);

      const navParams = new URLSearchParams(searchParams);
      if (targetFolderId && share?.folders) {
        const folderPathSlug = getFolderPathSlugFromId(
          targetFolderId,
          mapShareFolders(share.folders || []),
        );
        if (folderPathSlug) {
          navParams.set("folder", folderPathSlug);
        } else {
          navParams.delete("folder");
        }
      } else {
        navParams.delete("folder");
      }
      router.push(`/s/${alias}?${navParams.toString()}`);
    },
    [searchParams, router, alias, share?.folders, getFolderPathSlugFromId],
  );

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  // Filter content based on search query
  const filteredFolders = useMemo(
    () =>
      browseState.folders.filter((folder) =>
        folder.name?.toLowerCase().includes(searchQuery.toLowerCase()),
      ),
    [browseState.folders, searchQuery],
  );

  const filteredFiles = useMemo(
    () =>
      browseState.files.filter((file) =>
        file.name?.toLowerCase().includes(searchQuery.toLowerCase()),
      ),
    [browseState.files, searchQuery],
  );

  // Sync currentFolderId from URL when share data first loads
  // Depend on share?.id (stable) rather than share object (fresh on every refetch)
  useEffect(() => {
    if (share) {
      const resolvedFolderId = getFolderIdFromPathSlug(
        urlFolderSlug,
        mapShareFolders(share.folders || []),
      );
      setCurrentFolderId(resolvedFolderId);
    }
    // Note: share?.id used instead of share to avoid re-running on every refetch (shape is stable).
  }, [share?.id, urlFolderSlug, getFolderIdFromPathSlug]);

  return {
    folders: filteredFolders,
    files: filteredFiles,
    path: browseState.path,
    isBrowseLoading: browseState.isLoading,
    browseError: browseState.error,
    currentFolderId,
    searchQuery,
    navigateToFolder,
    handleSearch,
  };
}
