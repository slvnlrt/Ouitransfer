import { Check, CloudUpload, X } from "lucide-react";

import { Spinner } from "@/components/ui/spinner";
import type { FileUploadStatus } from "@/hooks/use-uppy-upload";
import { cn } from "@/lib/utils";

interface StatusIconProps {
  status: FileUploadStatus | string;
  /** Override the default icon size class. Defaults to "size-4". */
  sizeClass?: string;
}

/**
 * Renders the appropriate icon for a file upload status.
 * Returns `null` for "pending" or unrecognised statuses.
 */
export function StatusIcon({ status, sizeClass }: StatusIconProps) {
  const size = sizeClass ?? "size-4";

  switch (status) {
    case "uploading":
      return <Spinner size="xs" className={cn("text-primary", sizeClass)} />;
    case "success":
      return <Check className={cn(size, "text-emerald-600 dark:text-emerald-400")} />;
    case "error":
      return <X className={cn(size, "text-destructive")} />;
    case "cancelled":
      return <X className={cn(size, "text-muted-foreground")} />;
    default:
      return null;
  }
}
