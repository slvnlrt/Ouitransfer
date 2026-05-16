import { getFileIcon } from "@/utils/file-icons";
import { cn } from "@/lib/utils";

interface FileTypeIconProps {
  /** File name (used to determine the extension and thus the icon). */
  fileName: string;
  /** Override the default size class. Defaults to "size-4". */
  className?: string;
}

/**
 * Renders a colored icon matching the given file's type (by extension).
 * Delegates to `getFileIcon()` from `@/utils/file-icons`.
 */
export function FileTypeIcon({ fileName, className }: FileTypeIconProps) {
  const { icon: Icon, color } = getFileIcon(fileName);
  return <Icon className={cn("size-4", color, className)} />;
}
