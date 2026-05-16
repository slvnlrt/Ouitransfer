import { useTranslations } from "next-intl";

import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { getFileExtension } from "@/utils/file-types";

interface TextPreviewProps {
  content: string | null;
  fileName: string;
  isLoading?: boolean;
}

export function TextPreview({ content, fileName, isLoading }: TextPreviewProps) {
  const t = useTranslations();
  const extension = getFileExtension(fileName);

  if (isLoading || !content) {
    return (
      <ScrollArea className="w-full max-h-[600px]">
        <div className="w-full border rounded-lg overflow-hidden bg-card">
          <div className="flex items-center justify-center h-32">
            <div className="flex flex-col items-center gap-2">
              <Spinner size="md" />
              <p className="text-sm text-muted-foreground">{t("filePreview.loading")}</p>
            </div>
          </div>
        </div>
      </ScrollArea>
    );
  }

  return (
    <ScrollArea className="w-full max-h-[600px]">
      <div className="w-full border rounded-lg overflow-hidden bg-card">
        <pre className="p-4 text-sm font-mono whitespace-pre-wrap break-words overflow-x-auto">
          <code className={`language-${extension || "text"}`}>{content}</code>
        </pre>
      </div>
    </ScrollArea>
  );
}
