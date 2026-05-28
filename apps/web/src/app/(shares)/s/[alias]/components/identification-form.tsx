"use client";

import { UserCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

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
import type { ShareMetadata } from "@/http/endpoints/shares/types";

interface IdentificationFormProps {
  isOpen: boolean;
  metadata: ShareMetadata | null;
  isSubmitting: boolean;
  onSubmit: (name: string | undefined, email: string | undefined) => void;
}

export function IdentificationForm({
  isOpen,
  metadata,
  isSubmitting,
  onSubmit,
}: IdentificationFormProps) {
  const t = useTranslations();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const showNameField = metadata ? metadata.nameFieldRequired !== "HIDDEN" : false;
  const showEmailField = metadata ? metadata.emailFieldRequired !== "HIDDEN" : false;
  const nameRequired = metadata?.nameFieldRequired === "REQUIRED";
  const emailRequired = metadata?.emailFieldRequired === "REQUIRED";

  const handleSubmit = () => {
    onSubmit(
      showNameField ? name || undefined : undefined,
      showEmailField ? email || undefined : undefined,
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSubmit();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={() => {}} modal>
      <DialogContent>
        <DialogHeader className="flex flex-col gap-1">
          <DialogTitle>{t("share.identification.title")}</DialogTitle>
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <UserCircle className="size-4" />
            <p>{t("share.identification.subtitle")}</p>
          </div>
        </DialogHeader>
        <div className="py-4 space-y-4">
          {showNameField && (
            <div className="space-y-2">
              <Label htmlFor="visitor-name">
                {t("share.identification.nameLabel")}
                {!nameRequired && (
                  <span className="ml-1 text-muted-foreground text-xs">
                    ({t("share.identification.optional")})
                  </span>
                )}
              </Label>
              <Input
                id="visitor-name"
                type="text"
                value={name}
                placeholder={t("share.identification.nameLabel")}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={handleKeyDown}
                required={nameRequired}
              />
            </div>
          )}
          {showEmailField && (
            <div className="space-y-2">
              <Label htmlFor="visitor-email">
                {t("share.identification.emailLabel")}
                {!emailRequired && (
                  <span className="ml-1 text-muted-foreground text-xs">
                    ({t("share.identification.optional")})
                  </span>
                )}
              </Label>
              <Input
                id="visitor-email"
                type="email"
                value={email}
                placeholder={t("share.identification.emailLabel")}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={handleKeyDown}
                required={emailRequired}
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {t("share.identification.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
