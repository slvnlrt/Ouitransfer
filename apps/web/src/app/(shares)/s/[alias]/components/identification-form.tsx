"use client";

import { UserCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader } from "@/components/ui/loader";
import type { ShareMetadata } from "@/http/endpoints/shares/types";

interface IdentificationFormProps {
  isOpen: boolean;
  metadata: ShareMetadata | null;
  metadataError?: boolean;
  refetchMetadata: () => void;
  isSubmitting: boolean;
  onSubmit: (name: string | undefined, email: string | undefined) => void;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function IdentificationForm({
  isOpen,
  metadata,
  metadataError,
  refetchMetadata,
  isSubmitting,
  onSubmit,
}: IdentificationFormProps) {
  const t = useTranslations();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [attempted, setAttempted] = useState(false);
  const firstInputRef = useRef<HTMLInputElement>(null);
  const hasFocusedRef = useRef(false);

  // Autofocus the first visible input on first appearance only
  useEffect(() => {
    if (metadata && firstInputRef.current && !hasFocusedRef.current) {
      firstInputRef.current.focus();
      hasFocusedRef.current = true;
    }
  }, [metadata]);

  const showNameField = metadata ? metadata.nameFieldRequired !== "HIDDEN" : false;
  const showEmailField = metadata ? metadata.emailFieldRequired !== "HIDDEN" : false;
  const nameRequired = metadata?.nameFieldRequired === "REQUIRED";
  const emailRequired = metadata?.emailFieldRequired === "REQUIRED";

  const nameError = attempted && nameRequired && !name.trim();
  const emailError =
    attempted &&
    ((emailRequired && !email.trim()) ||
      (showEmailField && email.trim() && !EMAIL_REGEX.test(email.trim())));
  const emailErrorMessage =
    emailRequired && !email.trim()
      ? t("share.identification.emailRequired")
      : showEmailField && email.trim() && !EMAIL_REGEX.test(email.trim())
        ? t("share.identification.emailInvalid")
        : null;

  const canSubmit = (() => {
    if (nameRequired && !name.trim()) return false;
    if (emailRequired && !email.trim()) return false;
    if (showEmailField && email.trim() && !EMAIL_REGEX.test(email.trim())) return false;
    return true;
  })();

  const handleSubmit = () => {
    setAttempted(true);
    if (!canSubmit) return;
    onSubmit(
      showNameField ? name.trim() || undefined : undefined,
      showEmailField ? email.trim() || undefined : undefined,
    );
  };

  return (
    <Dialog
      open={isOpen}
      // Intentionally prevent dismissal — user must identify before accessing the share
      onOpenChange={() => {}}
      modal
    >
      <DialogContent>
        <DialogHeader className="flex flex-col gap-1">
          <DialogTitle>{t("share.identification.title")}</DialogTitle>
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <UserCircle className="size-4" />
            <p>{t("share.identification.subtitle")}</p>
          </div>
        </DialogHeader>
        {!metadata ? (
          metadataError ? (
            <div className="flex flex-col items-center gap-4 py-8">
              <p className="text-sm text-destructive">{t("share.identification.metadataError")}</p>
              <Button variant="outline" size="sm" onClick={() => refetchMetadata()}>
                {t("common.retry")}
              </Button>
            </div>
          ) : (
            <div className="flex justify-center py-8">
              <Loader size="sm" />
            </div>
          )
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmit();
            }}
          >
            <div className="py-4 space-y-4">
              {showNameField && (
                <div className="space-y-2">
                  <Label htmlFor="visitor-name">
                    {t("share.identification.nameLabel")}
                    {nameRequired ? (
                      <span className="text-destructive ml-1" aria-hidden="true">
                        *
                      </span>
                    ) : (
                      <span className="ml-1 text-muted-foreground text-xs">
                        ({t("share.identification.optional")})
                      </span>
                    )}
                  </Label>
                  <Input
                    ref={showNameField ? firstInputRef : undefined}
                    id="visitor-name"
                    type="text"
                    value={name}
                    placeholder={t("share.identification.nameLabel")}
                    onChange={(e) => setName(e.target.value)}
                    required={nameRequired}
                    aria-invalid={nameError || undefined}
                  />
                  {nameError && (
                    <p className="text-xs text-destructive">
                      {t("share.identification.nameRequired")}
                    </p>
                  )}
                </div>
              )}
              {showEmailField && (
                <div className="space-y-2">
                  <Label htmlFor="visitor-email">
                    {t("share.identification.emailLabel")}
                    {emailRequired ? (
                      <span className="text-destructive ml-1" aria-hidden="true">
                        *
                      </span>
                    ) : (
                      <span className="ml-1 text-muted-foreground text-xs">
                        ({t("share.identification.optional")})
                      </span>
                    )}
                  </Label>
                  <Input
                    ref={!showNameField ? firstInputRef : undefined}
                    id="visitor-email"
                    type="email"
                    value={email}
                    placeholder={t("share.identification.emailLabel")}
                    onChange={(e) => setEmail(e.target.value)}
                    required={emailRequired}
                    aria-invalid={emailError || undefined}
                  />
                  {emailError && emailErrorMessage && (
                    <p className="text-xs text-destructive">{emailErrorMessage}</p>
                  )}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button
                type="submit"
                disabled={!metadata || isSubmitting || (attempted && !canSubmit)}
              >
                {t("share.identification.submit")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
