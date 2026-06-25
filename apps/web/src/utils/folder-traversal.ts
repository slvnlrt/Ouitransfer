/**
 * Recursively collects all files in a folder tree with their relative paths.
 * Used by file manager, public share, and download flows to build zip archives.
 */

interface TraversableFile {
  id: string;
  name: string;
  objectName: string;
  folderId?: string | null;
}

interface TraversableFolder {
  id: string;
  name: string;
  parentId?: string | null;
}

export interface FileWithPath<T extends TraversableFile = TraversableFile> {
  file: T;
  path: string;
}

/**
 * Recursively gets all files within a folder, building relative paths as it descends.
 *
 * @param targetFolderId - The folder to start traversal from
 * @param allFiles - All files in the scope (share, user files, etc.)
 * @param allFolders - All folders in the scope
 * @param currentPath - The relative path prefix for the current level (defaults to "")
 * @returns An array of files with their relative path within the folder tree
 */
export function getFolderFilesWithPath<T extends TraversableFile>(
  targetFolderId: string,
  allFiles: T[],
  allFolders: TraversableFolder[],
  currentPath: string = "",
): FileWithPath<T>[] {
  const filesWithPath: FileWithPath<T>[] = [];

  // Get direct files in this folder
  const directFiles = allFiles.filter((f) => f.folderId === targetFolderId);
  for (const file of directFiles) {
    filesWithPath.push({ file, path: currentPath });
  }

  // Get subfolders and process them recursively
  const subfolders = allFolders.filter((f) => f.parentId === targetFolderId);
  for (const subfolder of subfolders) {
    const subfolderPath = currentPath ? `${currentPath}/${subfolder.name}` : subfolder.name;
    filesWithPath.push(
      ...getFolderFilesWithPath(subfolder.id, allFiles, allFolders, subfolderPath),
    );
  }

  return filesWithPath;
}
