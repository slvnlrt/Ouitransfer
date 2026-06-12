"use client";

import { Check, Copy, Link, MailCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { generateInviteToken } from "@/http/endpoints/invite";
import { logger } from "@/lib/logger";
import { isValidEmail } from "@/utils/email";

interface GenerateInviteLinkModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function GenerateInviteLinkModal({ isOpen, onClose }: GenerateInviteLinkModalProps) {
  const t = useTranslations();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [email, setEmail] = useState("");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const { copied, copy } = useCopyToClipboard();

  const trimmedEmail = email.trim();
  const wantsEmail = trimmedEmail.length > 0;

  const handleSubmit = async () => {
    if (wantsEmail && !isValidEmail(trimmedEmail)) {
      toast.error(t("users.invite.errors.invalidEmail"));
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await generateInviteToken(wantsEmail ? { email: trimmedEmail } : undefined);

      // Prefer the server-built URL (from the admin-configured appUrl) so the
      // copied link matches the emailed one and stays correct in split-hostname
      // deployments. Fall back to the current origin only when appUrl is unset.
      setInviteUrl(
        response.registrationUrl ??
          `${window.location.origin}/register-with-invite/${response.token}`,
      );

      if (wantsEmail) {
        if (response.emailSent) {
          setSentTo(trimmedEmail);
          toast.success(t("users.invite.emailSentToast"));
        } else {
          // Token was created but the email could not be queued (e.g. SMTP disabled).
          setSentTo(null);
          toast.warning(t("users.invite.errors.sendFailed"));
        }
      } else {
        setSentTo(null);
        toast.success(t("users.invite.generated"));
      }
    } catch (error) {
      logger.error("Failed to generate invite token:", {
        err: error instanceof Error ? error.message : String(error),
      });
      toast.error(t("users.invite.errors.generateFailed"));
    } finally {
      setIsSubmitting(false);
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
    setSentTo(null);
    setEmail("");
    onClose();
  };

  const submitLabel = isSubmitting
    ? wantsEmail
      ? t("users.invite.sending")
      : t("users.invite.generating")
    : wantsEmail
      ? t("users.invite.send")
      : t("users.invite.generate");

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link className="size-6" />
            {t("users.invite.title")}
          </DialogTitle>
          <DialogDescription>{t("users.invite.description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {!inviteUrl ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="invite-email">{t("users.invite.emailLabel")}</Label>
                <Input
                  id="invite-email"
                  type="email"
                  autoComplete="off"
                  placeholder={t("users.invite.emailPlaceholder")}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !isSubmitting) {
                      e.preventDefault();
                      handleSubmit();
                    }
                  }}
                  disabled={isSubmitting}
                />
                <p className="text-muted-foreground text-xs">{t("users.invite.emailHelp")}</p>
              </div>
              <Button onClick={handleSubmit} disabled={isSubmitting} className="w-full">
                {submitLabel}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {sentTo && (
                <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
                  <MailCheck className="mt-0.5 size-[18px] shrink-0 text-primary" />
                  <span>{t("users.invite.emailSentNotice", { email: sentTo })}</span>
                </div>
              )}

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

              <DialogFooter>
                <Button variant="outline" onClick={handleClose}>
                  {t("users.invite.close")}
                </Button>
              </DialogFooter>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
