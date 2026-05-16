"use client";

import { Check, Copy, Link } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { generateInviteToken } from "@/http/endpoints/invite";
import { logger } from "@/lib/logger";

interface GenerateInviteLinkModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function GenerateInviteLinkModal({ isOpen, onClose }: GenerateInviteLinkModalProps) {
  const t = useTranslations();
  const [isGenerating, setIsGenerating] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const { copied, copy } = useCopyToClipboard();

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const response = await generateInviteToken();

      const inviteUrl = `${window.location.origin}/register-with-invite/${response.token}`;

      setInviteUrl(inviteUrl);
      toast.success(t("users.invite.generated"));
    } catch (error) {
      logger.error("Failed to generate invite token:", {
        err: error instanceof Error ? error.message : String(error),
      });
      toast.error(t("users.invite.errors.generateFailed"));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopy = async () => {
    if (!inviteUrl) return;

    const ok = await copy(inviteUrl);
    if (ok) {
      toast.success(t("users.invite.linkCopied"));
    } else {
      toast.error(t("users.invite.errors.copyFailed"));
    }
  };

  const handleClose = () => {
    setInviteUrl(null);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link className="size-6" />
            {t("users.invite.title")}
          </DialogTitle>
          <DialogDescription>{t("users.invite.description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {!inviteUrl ? (
            <Button onClick={handleGenerate} disabled={isGenerating} className="w-full">
              {isGenerating ? t("users.invite.generating") : t("users.invite.generate")}
            </Button>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/50 p-4">
                <h4 className="mb-2 font-semibold text-sm">{t("users.invite.linkReady")}</h4>
                <p className="mb-4 text-muted-foreground text-sm">
                  {t("users.invite.linkReadyDescription")}
                </p>
                <div className="space-y-2">
                  <Label htmlFor="invite-url">{t("users.invite.copyLink")}</Label>
                  <div className="flex gap-2">
                    <Input
                      id="invite-url"
                      value={inviteUrl}
                      readOnly
                      className="font-mono text-sm"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={handleCopy}
                      className="shrink-0"
                    >
                      {copied ? (
                        <Check className="size-[18px]" />
                      ) : (
                        <Copy className="size-[18px]" />
                      )}
                    </Button>
                  </div>
                  <p className="text-muted-foreground text-xs">{t("users.invite.expiresIn")}</p>
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={handleClose}>
                  {t("users.invite.close")}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
