"use client";

import { IconCheck, IconCopy } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { generateEmbedToken } from "@/http/endpoints/files";
import { queryKeys } from "@/lib/query-keys";

interface EmbedCodeDisplayProps {
  imageUrl: string;
  fileName: string;
  fileId: string;
  shareId?: string;
}

export function EmbedCodeDisplay({ imageUrl, fileName, fileId, shareId }: EmbedCodeDisplayProps) {
  const t = useTranslations();
  const [copiedType, setCopiedType] = useState<string | null>(null);

  const embedQuery = useQuery({
    queryKey: queryKeys.files.embedToken(fileId, shareId ?? ""),
    queryFn: async () => {
      const response = await generateEmbedToken({ fileId, shareId: shareId! });
      return `${window.location.origin}/e/${response.data.token}`;
    },
    enabled: !!fileId && !!shareId && typeof window !== "undefined",
  });

  const fullUrl = embedQuery.data ?? "";

  // If no URL available, don't render
  if (!fullUrl && !imageUrl) return null;

  const directLink = fullUrl || imageUrl;
  const htmlCode = `<img src="${directLink}" alt="${fileName}" />`;
  const bbCode = `[img]${directLink}[/img]`;

  const copyToClipboard = async (text: string, type: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedType(type);
      setTimeout(() => setCopiedType(null), 2000);
    } catch {
      // clipboard write failed — silently ignore
    }
  };

  if (!fullUrl) return null;

  return (
    <Card>
      <CardContent>
        <div className="space-y-4">
          <div>
            <Label className="text-sm font-semibold">{t("embedCode.title")}</Label>
            <p className="text-xs text-muted-foreground mt-1">{t("embedCode.description")}</p>
          </div>

          <Tabs defaultValue="direct" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="direct" className="cursor-pointer">
                {t("embedCode.tabs.directLink")}
              </TabsTrigger>
              <TabsTrigger value="html" className="cursor-pointer">
                {t("embedCode.tabs.html")}
              </TabsTrigger>
              <TabsTrigger value="bbcode" className="cursor-pointer">
                {t("embedCode.tabs.bbcode")}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="direct" className="space-y-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={directLink}
                  className="flex-1 px-3 py-2 text-sm border rounded-md bg-muted/50 font-mono"
                />
                <Button
                  size="default"
                  variant="outline"
                  onClick={() => copyToClipboard(directLink, "direct")}
                  className="shrink-0 h-full"
                >
                  {copiedType === "direct" ? (
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
              <p className="text-xs text-muted-foreground">
                {t("embedCode.directLinkDescription")}
              </p>
            </TabsContent>

            <TabsContent value="html" className="space-y-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={htmlCode}
                  className="flex-1 px-3 py-2 text-sm border rounded-md bg-muted/50 font-mono"
                />
                <Button
                  variant="outline"
                  onClick={() => copyToClipboard(htmlCode, "html")}
                  className="shrink-0 h-full"
                >
                  {copiedType === "html" ? (
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
              <p className="text-xs text-muted-foreground">{t("embedCode.htmlDescription")}</p>
            </TabsContent>

            <TabsContent value="bbcode" className="space-y-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={bbCode}
                  className="flex-1 px-3 py-2 text-sm border rounded-md bg-muted/50 font-mono"
                />
                <Button
                  variant="outline"
                  onClick={() => copyToClipboard(bbCode, "bbcode")}
                  className="shrink-0 h-full"
                >
                  {copiedType === "bbcode" ? (
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
              <p className="text-xs text-muted-foreground">{t("embedCode.bbcodeDescription")}</p>
            </TabsContent>
          </Tabs>
        </div>
      </CardContent>
    </Card>
  );
}
