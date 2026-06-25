"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { useSecureConfigValue } from "@/hooks/use-secure-configs";
import { listUserShares, notifyRecipients } from "@/http/endpoints";
import type { Share } from "@/http/endpoints/shares/types";
import { queryKeys } from "@/lib/query-keys";

export function useShares() {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");

  const { value: smtpEnabled } = useSecureConfigValue("smtpEnabled");

  const sharesQuery = useQuery({
    queryKey: queryKeys.shares.list(),
    queryFn: async () => {
      const response = await listUserShares();
      const allShares = response.data.shares || [];
      return [...allShares].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    },
  });

  const shares = sharesQuery.data ?? [];

  const filteredShares = useMemo(
    () =>
      shares.filter(
        (share) => share.name?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false,
      ),
    [shares, searchQuery],
  );

  const handleCopyLink = (share: Share) => {
    if (!share.alias?.alias) return;

    const link = `${window.location.origin}/s/${share.alias.alias}`;

    navigator.clipboard.writeText(link);
    toast.success(t("shares.messages.linkCopied"));
  };

  const notifyMutation = useMutation({
    mutationFn: async (share: Share) => {
      await notifyRecipients(share.id, {});
    },
    onSuccess: () => {
      toast.success(t("shares.messages.recipientsNotified"));
    },
    onError: () => {
      toast.error(t("shares.errors.notifyFailed"));
    },
  });

  const handleNotifyRecipients = async (share: Share) => {
    await notifyMutation.mutateAsync(share);
  };

  const loadShares = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.shares.all });
  };

  return {
    shares,
    isLoading: sharesQuery.isLoading,
    searchQuery,
    filteredShares,
    smtpEnabled: smtpEnabled || "false",
    setSearchQuery,
    handleCopyLink,
    handleNotifyRecipients,
    loadShares,
  };
}
