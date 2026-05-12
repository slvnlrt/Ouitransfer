"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { generateEmbedToken } from "@/http/endpoints/files";
import { queryKeys } from "@/lib/query-keys";

interface MediaEmbedLinkProps {
  fileId: string;
  shareId?: string;
}

export function MediaEmbedLink({ fileId, shareId }: MediaEmbedLinkProps) {
  const t = useTranslations();
  const [copied, setCopied] = useState(false);

  const embedQuery = useQuery({
    queryKey: queryKeys.files.embedToken(fileId, shareId ?? ""),
    queryFn: async () => {
      const response = await generateEmbedToken({ fileId, shareId: shareId! });
      return `${window.location.origin}/e/${response.data.token}`;
    },
    enabled: !!fileId && !!shareId && typeof window !== "undefined",
  });

  const embedUrl = embedQuery.data ?? "";

  // Don't render if no embed URL is available
  if (!embedUrl) return null;

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(embedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard write failed — silently ignore
    }
  };

  return (
    <Card>
      <CardContent>
        <div className="space-y-3">
          <div>
            <Label className="text-sm font-semibold">{t("embedCode.title")}</Label>
            <p className="text-xs text-muted-foreground mt-1">
              {t("embedCode.directLinkDescription")}
            </p>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              readOnly
              value={embedUrl}
              className="flex-1 px-3 py-2 text-sm border rounded-md bg-muted/50 font-mono"
            />
            <Button
              size="default"
              variant="outline"
              onClick={copyToClipboard}
              className="shrink-0 h-full"
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4 me-1" />
                  {t("common.copied")}
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4 me-1" />
                  {t("common.copy")}
                </>
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
