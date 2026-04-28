"use client";

import { IconCheck, IconCopy } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { generateEmbedToken } from "@/http/endpoints/files";
import { logger } from "@/lib/logger";

interface MediaEmbedLinkProps {
  fileId: string;
  shareId?: string;
}

export function MediaEmbedLink({ fileId, shareId }: MediaEmbedLinkProps) {
  const t = useTranslations();
  const [copied, setCopied] = useState(false);
  const [embedUrl, setEmbedUrl] = useState<string>("");

  useEffect(() => {
    if (typeof window === "undefined" || !fileId) return;

    const origin = window.location.origin;

    if (shareId) {
      // Use token-based embed URL
      generateEmbedToken({ fileId, shareId })
        .then((response) => {
          setEmbedUrl(`${origin}/e/${response.data.token}`);
        })
        .catch((error) => {
          logger.error("Failed to generate embed token:", {
            err: error instanceof Error ? error.message : String(error),
          });
          setEmbedUrl("");
        });
    } else {
      // No share context — embed requires a share
      setEmbedUrl("");
    }
  }, [fileId, shareId]);

  // Don't render if no embed URL is available
  if (!embedUrl) return null;

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(embedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      logger.error("Failed to copy:", {
        err: error instanceof Error ? error.message : String(error),
      });
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
                  <IconCheck className="h-4 w-4 mr-1" />
                  {t("common.copied")}
                </>
              ) : (
                <>
                  <IconCopy className="h-4 w-4 mr-1" />
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
