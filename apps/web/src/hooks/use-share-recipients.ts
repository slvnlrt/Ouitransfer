"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { addRecipients, notifyRecipients } from "@/http/endpoints";
import type { Share } from "@/http/endpoints/shares/types";

export interface ShareRecipientsHook {
  shareToManageRecipients: Share | null;
  setShareToManageRecipients: (share: Share | null) => void;
  handleManageRecipients: (shareId: string, recipients: string[]) => Promise<void>;
  handleNotifyRecipients: (share: Share) => Promise<void>;
}

export function useShareRecipients(onSuccess: () => void): ShareRecipientsHook {
  const t = useTranslations();
  const [shareToManageRecipients, setShareToManageRecipients] = useState<Share | null>(null);

  const handleManageRecipients = async (shareId: string, recipients: string[]) => {
    try {
      await addRecipients(shareId, { emails: recipients });
      toast.success(t("shareManager.recipientsUpdateSuccess"));
      onSuccess();
      setShareToManageRecipients(null);
    } catch {
      toast.error(t("shareManager.recipientsUpdateError"));
    }
  };

  const handleNotifyRecipients = async (share: Share) => {
    const loadingToast = toast.loading(t("shareManager.notifyLoading"));

    try {
      await notifyRecipients(share.id, {});
      toast.dismiss(loadingToast);
      toast.success(t("shareManager.notifySuccess"));
    } catch {
      toast.dismiss(loadingToast);
      toast.error(t("shareManager.notifyError"));
    }
  };

  return {
    shareToManageRecipients,
    setShareToManageRecipients,
    handleManageRecipients,
    handleNotifyRecipients,
  };
}
